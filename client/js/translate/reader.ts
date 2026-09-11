// The reading pipeline's glue (spec § Reading pipeline): the one module
// beside index.ts and fakePort.ts that imports the store. A second
// `socket.on("msg")` listener (registered by socket-events/translate.ts
// after socket-events/msg.ts pushed the message) runs eligibility →
// detection → context → queue; the queue writes state.translations; the
// header globe and the panel call setReading/setChannelOptions; the chip
// and the toolbar call retranslate/showOriginal/retryTranslation.

import {getBranding} from "../branding";
import socket from "../socket";
import {store, type TranslationEntry} from "../store";
import type {ClientChan, ClientMessage, ClientNetwork} from "../types";
import {
	type ChannelTranslation,
	channelKey,
	defaultChannelTranslation,
	forgetChannel,
	forgetNetwork,
	loadAll,
	setChannelTranslation,
} from "./channelStore";
import {buildContext} from "./context";
import {LanguagePrior, detectLanguage} from "./detect";
import {isEligible, plainTextOf} from "./eligibility";
import {translateService} from "./index";
import {type QueueItem, type QueueUpdate, TranslateQueue} from "./queue";
import {protect} from "./spans";

// When this page started. A replayed message (a reconnect's catch-up)
// is only eligible when it is newer than this as well as newer than the
// channel's switch-on moment: `since` is persisted while the
// translations are not, so without this a reload would re-translate
// every replayed line back to a switch-on that may be days old.
const SESSION_START = Date.now();

const queues = new Map<string, TranslateQueue>();
const priors = new Map<string, LanguagePrior>();
const arrivals = new Map<number, number>();
/** The last item queued per message, for retries. */
const items = new Map<number, {network: string; item: QueueItem}>();

export function channelTranslation(
	network: ClientNetwork,
	channel: ClientChan
): ChannelTranslation {
	return (
		store.state.translateChannels[channelKey(network.uuid, channel.name)] ??
		defaultChannelTranslation()
	);
}

export function translationAvailable(): boolean {
	const tier = store.state.translation.capability?.tier;

	return translateService().enabled && tier !== undefined && tier !== "none";
}

function priorFor(network: ClientNetwork, channel: ClientChan): LanguagePrior {
	const key = channelKey(network.uuid, channel.name);
	let prior = priors.get(key);

	if (!prior) {
		prior = new LanguagePrior();
		priors.set(key, prior);
	}

	return prior;
}

function queueFor(network: ClientNetwork): TranslateQueue {
	let queue = queues.get(network.uuid);

	if (!queue) {
		const service = translateService();

		queue = new TranslateQueue({
			route: (from, to) => service.route(from, to).then((route) => route?.ref.engine ?? null),
			translate: (req, signal) => service.translate(req, signal),
			priority(chanId) {
				if (store.state.activeChannel?.channel.id === chanId) {
					return 0;
				}

				const index = network.channels.findIndex((c) => c.id === chanId);

				return index < 0 ? network.channels.length + 1 : index + 1;
			},
			arrivals: (chanId) => arrivals.get(chanId) ?? 0,
			onUpdate: (id, update) => applyUpdate(id, update),
			onPause: (engine, message) => store.commit("translationPaused", {engine, message}),
		});
		queues.set(network.uuid, queue);
	}

	return queue;
}

function applyUpdate(id: number, update: QueueUpdate): void {
	const existing = store.state.translations[id];

	// The queue is finished with the item, so the context it carries (up
	// to CONTEXT_LINES of text, the names and a copy of the channel's term
	// memory) goes with it. Never on "failed": retryTranslation's fast
	// path is what that entry survives for; anything else is rebuilt by
	// retranslate.
	if (update.status === "done" || update.status === "dropped") {
		items.delete(id);
	}

	switch (update.status) {
		case "pending":
			if (existing) {
				store.commit("translationPatch", {
					id,
					patch: {
						status: "pending",
						text: update.text,
						engine: update.engine,
						error: null,
					},
				});
			}

			break;
		case "done":
			store.commit("translationPatch", {
				id,
				patch: {status: "done", text: update.text, engine: update.engine, error: null},
			});
			break;
		case "failed":
			store.commit("translationPatch", {id, patch: {status: "failed", error: update.error}});
			break;
		case "dropped":
			if (existing && existing.status !== "done") {
				store.commit("translationPatch", {id, patch: {status: "dropped"}});
			}

			break;
	}
}

/** Drop the remembered queue items the predicate matches. */
function forgetItems(match: (entry: {network: string; item: QueueItem}) => boolean): void {
	for (const [id, entry] of items) {
		if (match(entry)) {
			items.delete(id);
		}
	}
}

function commitChannel(
	network: ClientNetwork,
	channel: ClientChan,
	value: ChannelTranslation
): void {
	store.commit("translateChannelSet", {key: channelKey(network.uuid, channel.name), value});
}

/** Turn reading on (a language) or off (null) for a channel. */
export function setReading(network: ClientNetwork, channel: ClientChan, lang: string | null): void {
	const value = setChannelTranslation(network.uuid, channel.name, {read: lang});

	commitChannel(network, channel, value);

	if (!lang) {
		queues.get(network.uuid)?.cancelChannel(channel.id);
	}
}

export function setChannelOptions(
	network: ClientNetwork,
	channel: ClientChan,
	patch: Partial<Pick<ChannelTranslation, "write" | "formality" | "variant">>
): void {
	commitChannel(network, channel, setChannelTranslation(network.uuid, channel.name, patch));
}

function entryFor(from: string, to: string): TranslationEntry {
	return {status: "pending", text: "", from, to, engine: null, error: null, hidden: false};
}

/**
 * Consider one message. `force` is the toolbar's "Translate" and the chip's
 * "Retranslate": eligibility and the target check are skipped, and an
 * unknown source is left to the LLM. `replay` is the bus payload's flag: a
 * history catch-up, held to this page's session as well as to `since`.
 */
export async function translateMessage(
	network: ClientNetwork,
	channel: ClientChan,
	message: ClientMessage,
	force = false,
	replay = false
): Promise<void> {
	if (!message.text) {
		return;
	}

	// The service is created (and the device probe started) on first use,
	// which is often this very call: without waiting for it here, every
	// message that arrives before the probe resolves is silently dropped.
	if (!store.state.translation.capability) {
		await translateService().capabilities();
	}

	if (!translationAvailable()) {
		return;
	}

	const initial = channelTranslation(network, channel);
	const nicks = channel.users.map((u) => u.nick);

	if (!force) {
		// A cold boot does not translate history; a reconnect's catch-up
		// within a session does (SESSION_START).
		const since = replay ? Math.max(initial.since, SESSION_START) : initial.since;

		if (!initial.read || !isEligible(message, {since, nicks})) {
			return;
		}
	}

	const prior = priorFor(network, channel);
	const detection = await detectLanguage(plainTextOf(message.text, nicks), prior);

	// Detection (the first call also awaits the franc chunk download) can
	// take a while: re-read the switch afterwards, since a switch-off or a
	// target change during that wait must not still ship a translation.
	const settings = channelTranslation(network, channel);

	if (!force && !settings.read) {
		return;
	}

	const to = settings.read ?? store.state.settings.translateTo;

	if (!force && (detection.lang === null || detection.lang === to)) {
		return;
	}

	const from = detection.lang && detection.lang !== to ? detection.lang : null;
	const protectedText = protect(message.text);
	const item: QueueItem = {
		id: message.id,
		chanId: channel.id,
		text: protectedText.text,
		spans: protectedText.spans,
		from,
		to,
		context: buildContext(channel, message, {
			translated(id) {
				const entry = store.state.translations[id];

				return entry && entry.status === "done" ? entry.text : undefined;
			},
			terms: settings.terms,
			glossary: getBranding().translation?.glossary ?? [],
			formality: settings.formality,
			variant: settings.variant,
			sourceHint: from || prior.top(),
		}),
		arrivalsAtEnqueue: arrivals.get(channel.id) ?? 0,
		single: force,
	};

	items.set(message.id, {network: network.uuid, item});
	store.commit("translationEntry", {id: message.id, entry: entryFor(from ?? "", to)});

	if (force) {
		queueFor(network).retry(item);
	} else {
		queueFor(network).enqueue(item);
	}
}

export function retranslate(
	network: ClientNetwork,
	channel: ClientChan,
	message: ClientMessage
): void {
	// Toolbar hides the action while a line is pending, but no caller may double-queue a line
	if (store.state.translations[message.id]?.status === "pending") {
		return;
	}

	void translateMessage(network, channel, message, true);
}

export function showOriginal(id: number, hidden: boolean): void {
	store.commit("translationPatch", {id, patch: {hidden}});
}

/** A failed line's retry: resumes a paused engine as well. */
export function retryTranslation(
	network: ClientNetwork,
	channel: ClientChan,
	message: ClientMessage
): void {
	const paused = store.state.translation.paused;

	if (paused) {
		// state.translation.paused is global (one engine, however many
		// networks queue for it), so every queue that paused it resumes.
		for (const queue of queues.values()) {
			queue.resume(paused.engine);
		}

		store.commit("translationPaused", null);
	}

	const known = items.get(message.id);

	if (known && known.network === network.uuid) {
		store.commit("translationPatch", {id: message.id, patch: {status: "pending", error: null}});
		queueFor(network).retry(known.item);
	} else {
		retranslate(network, channel, message);
	}
}

export function initReader(): void {
	store.commit("translateChannelsLoaded", loadAll());

	// After socket-events/msg.ts pushed the message (import order in
	// socket-events/index.ts): the object in `data.msg` is the one in
	// `channel.messages`, so its id is the store id.
	socket.on("msg", (data) => {
		const target = store.getters.findChannel(data.chan);

		if (!target) {
			return;
		}

		arrivals.set(target.channel.id, (arrivals.get(target.channel.id) ?? 0) + 1);

		if (channelTranslation(target.network, target.channel).read) {
			void translateMessage(target.network, target.channel, data.msg, false, data.replay);
		}
	});

	// Registered before socket-events/part.ts (import order), so the
	// channel is still in the store when this runs.
	socket.on("part", (data) => {
		const target = store.getters.findChannel(data.chan);

		if (!target) {
			return;
		}

		queues.get(target.network.uuid)?.cancelChannel(target.channel.id);
		forgetChannel(target.network.uuid, target.channel.name);
		priors.delete(channelKey(target.network.uuid, target.channel.name));
		arrivals.delete(target.channel.id);
		forgetItems(({item}) => item.chanId === target.channel.id);
		store.commit(
			"translationRemoveMany",
			target.channel.messages.map((m) => m.id)
		);
		store.commit(
			"translateChannelRemove",
			channelKey(target.network.uuid, target.channel.name)
		);
	});

	// Registered before socket-events/quit.ts (import order), so the
	// network and its messages are still in the store when this runs.
	socket.on("quit", (data) => {
		queues.get(data.network)?.cancelAll();
		queues.delete(data.network);
		forgetNetwork(data.network);
		forgetItems(({network}) => network === data.network);

		const network = store.state.networks.find((n) => n.uuid === data.network);

		if (network) {
			store.commit(
				"translationRemoveMany",
				network.channels.flatMap((c) => c.messages.map((m) => m.id))
			);
		}

		for (const key of Object.keys(store.state.translateChannels)) {
			if (key.startsWith(`${data.network}/`)) {
				store.commit("translateChannelRemove", key);
			}
		}

		for (const key of [...priors.keys()]) {
			if (key.startsWith(`${data.network}/`)) {
				priors.delete(key);
			}
		}
	});
}
