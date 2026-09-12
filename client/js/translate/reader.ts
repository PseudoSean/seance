// The reading pipeline's glue (spec § Reading pipeline): one of the three
// modules — with index.ts and writer.ts — that import the store. A second
// `socket.on("msg")` listener (registered by
// socket-events/translate.ts after socket-events/msg.ts pushed the
// message) runs eligibility → detection → context → queue, and a second
// `socket.on("more")` does the same for a history page the reader asked
// for (newest first, capped); the queue
// writes state.translations; the header globe and the panel call
// setReading/setChannelOptions; the chip and the toolbar call
// retranslate/showOriginal/retryTranslation.

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
import {HISTORY_QUEUE_CAP, historyQueueOrder, isEligible, plainTextOf} from "./eligibility";
import {translateService} from "./index";
import {type QueueItem, type QueueUpdate, TranslateQueue} from "./queue";
import {protect, stripCopiedNickPrefix} from "./spans";

const queues = new Map<string, TranslateQueue>();
const priors = new Map<string, LanguagePrior>();
const arrivals = new Map<number, number>();
/**
 * Replayed lines seen per channel since its last live one: a join replay (a
 * reconnect's catch-up, or a reload's) is translated up to
 * `HISTORY_QUEUE_CAP` and then left alone. The reader sees a replay one
 * line at a time, so this counts the window rather than picking its newest
 * lines — what a "load more" can do because it arrives as a page.
 */
const replays = new Map<number, number>();
/** The last item queued per message, for retries. */
const items = new Map<number, {network: string; item: QueueItem}>();

/** Composer requests holding the reading queues (writer.ts); nested holds count. */
let holds = 0;

export function holdReading(): void {
	if (holds++ === 0) {
		for (const queue of queues.values()) {
			queue.hold();
		}
	}
}

export function releaseReading(): void {
	if (holds > 0 && --holds === 0) {
		for (const queue of queues.values()) {
			queue.release();
		}
	}
}

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

		if (holds > 0) {
			queue.hold();
		}

		queues.set(network.uuid, queue);
	}

	return queue;
}

/**
 * The finished translation with a nick prefix the model copied out of the
 * context taken off — but only when the message itself did not open with
 * one (spans.ts `stripCopiedNickPrefix`), which needs the message and its
 * channel. Read before the item is forgotten; an item, a channel or a
 * message we cannot find leaves the text as the engine gave it, since
 * keeping a prefix is the harmless way to be wrong.
 */
function withoutCopiedNick(id: number, known: {item: QueueItem} | undefined, text: string): string {
	if (!known) {
		return text;
	}

	const target = store.getters.findChannel(known.item.chanId);
	const source = target?.channel.messages.find((m) => m.id === id)?.text;

	if (!target || !source) {
		return text;
	}

	return stripCopiedNickPrefix(
		text,
		source,
		target.channel.users.map((u) => u.nick)
	);
}

function applyUpdate(id: number, update: QueueUpdate): void {
	const existing = store.state.translations[id];
	const known = items.get(id);

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
				patch: {
					status: "done",
					// The prompt shows the earlier lines as `nick: text`, so a
					// model can copy a name in that shape; only the finished
					// text is cleaned, since a stream's prefix is not a prefix
					// until the line after it has arrived.
					text: withoutCopiedNick(id, known, update.text),
					engine: update.engine,
					error: null,
				},
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

/**
 * Ask the view of that channel to open its translation panel (the channel
 * menu's "Translation…", which switches to the channel first). Store
 * state rather than an event: the view may not exist yet when it is asked.
 */
export function requestTranslationPanel(channel: ClientChan): void {
	store.commit("translationPanelFor", channel.id);
}

export function setChannelOptions(
	network: ClientNetwork,
	channel: ClientChan,
	patch: Partial<Pick<ChannelTranslation, "write" | "formality" | "variant" | "languages">>
): void {
	commitChannel(network, channel, setChannelTranslation(network.uuid, channel.name, patch));
}

function entryFor(from: string, to: string, candidates: string[]): TranslationEntry {
	return {
		status: "pending",
		text: "",
		from,
		to,
		candidates,
		engine: null,
		error: null,
		hidden: false,
	};
}

/**
 * Consider one message. `force` is the toolbar's "Translate" and the chip's
 * "Retranslate": eligibility and the target check are skipped, and an
 * unknown source is left to the LLM. `replay` is the bus payload's flag: a
 * history line, which the queue runs behind the channel's live ones.
 * `from` is the chip menu's "Retranslate from …": the reader has said what
 * the line is written in, so detection is skipped entirely — the source is
 * never null, the detector's candidates are carried over so the menu keeps
 * offering the alternatives, and nothing is noted into the channel's prior
 * (one reader's correction of one line is not the channel's language).
 * `options.history` is a "load more" the reader asked for: the switch-on
 * moment does not gate it (they are looking at that history now), while
 * everything else eligibility asks — own lines, pending ones, short ones —
 * still does.
 */
export async function translateMessage(
	network: ClientNetwork,
	channel: ClientChan,
	message: ClientMessage,
	force = false,
	replay = false,
	from?: string,
	options: {history?: boolean} = {}
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
		// A replayed line is gated by the switch-on moment alone, like a live
		// one: a channel switched on today does not translate last week's
		// scrollback, but a reconnect's catch-up and a reload's replay of
		// what was said since are translated. A "load more" is the reader
		// asking for that history, so `since` does not gate it — the rest of
		// eligibility still does.
		const since = options.history ? 0 : initial.since;

		if (!initial.read || !isEligible(message, {since, nicks})) {
			return;
		}
	}

	const prior = priorFor(network, channel);
	// A chosen source is the answer detection would have given: no chunk to
	// download, no verdict to reach, and the previous entry's candidates
	// stay on offer.
	const detection = from
		? {
				lang: from,
				confidence: 1,
				candidates: store.state.translations[message.id]?.candidates ?? [],
		  }
		: await detectLanguage(plainTextOf(message.text, nicks), prior, initial.languages, {
				// The language the reader already reads, so a channel that
				// declares one other can place a line too short for franc. The
				// switch is re-read after the await below; this is the target as
				// it stands now, which is the one the reader is looking at.
				exclude: initial.read ?? store.state.settings.translateTo,
		  });

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

	// A chosen source is used as it stands, even when it is the target: the
	// reader asked for that translation.
	const source = from ?? (detection.lang && detection.lang !== to ? detection.lang : null);
	const protectedText = protect(message.text, {nicks});
	const item: QueueItem = {
		id: message.id,
		chanId: channel.id,
		text: protectedText.text,
		spans: protectedText.spans,
		meta: protectedText.meta,
		from: source,
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
			sourceHint: source || prior.top(),
		}),
		arrivalsAtEnqueue: arrivals.get(channel.id) ?? 0,
		single: force,
		// A history line waits behind the channel's live ones (queue.ts): what
		// is being said now matters more than what was said then. A forced
		// request is never history, however old the line is — someone asked.
		...(!force && (replay || options.history) ? {history: true as const} : {}),
	};

	items.set(message.id, {network: network.uuid, item});
	store.commit("translationEntry", {
		id: message.id,
		entry: entryFor(source ?? "", to, detection.candidates),
	});

	if (force) {
		queueFor(network).retry(item);
	} else {
		queueFor(network).enqueue(item);
	}
}

/**
 * Let a paused engine run again. state.translation.paused is global (one
 * engine, however many networks queue for it), so every queue resumes it.
 * Both ways back into the queue go through here: an engine pauses after
 * three failures in a row, which is exactly when a user reaches for a
 * retry, and an item queued behind a paused engine never runs.
 */
function resumePausedEngines(): void {
	const paused = store.state.translation.paused;

	if (!paused) {
		return;
	}

	for (const queue of queues.values()) {
		queue.resume(paused.engine);
	}

	store.commit("translationPaused", null);
}

/**
 * Translate one line on request: the toolbar's Translate and the chip
 * menu's Retranslate. `from` is the menu's "Retranslate from …" — the
 * source the reader chose, detection skipped.
 */
export function retranslate(
	network: ClientNetwork,
	channel: ClientChan,
	message: ClientMessage,
	from?: string
): void {
	// Toolbar hides the action while a line is pending, but no caller may double-queue a line
	if (store.state.translations[message.id]?.status === "pending") {
		return;
	}

	resumePausedEngines();
	void translateMessage(network, channel, message, true, false, from);
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
	resumePausedEngines();

	const known = items.get(message.id);

	if (known && known.network === network.uuid) {
		store.commit("translationPatch", {id: message.id, patch: {status: "pending", error: null}});
		queueFor(network).retry(known.item);
	} else {
		// The remembered item is gone, so the request is built again — with
		// the source the failed entry had, whether the detector or the reader
		// chose it: a retry is the same translation, not a fresh guess.
		retranslate(
			network,
			channel,
			message,
			store.state.translations[message.id]?.from || undefined
		);
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

		// A replay window: count what it brings and stop queueing past the
		// cap, so a reload of a channel that has been on for a week does not
		// queue a week. A live line closes the window.
		if (data.replay) {
			const seen = (replays.get(target.channel.id) ?? 0) + 1;

			replays.set(target.channel.id, seen);

			if (seen > HISTORY_QUEUE_CAP) {
				return;
			}
		} else {
			replays.delete(target.channel.id);
		}

		if (channelTranslation(target.network, target.channel).read) {
			void translateMessage(target.network, target.channel, data.msg, false, data.replay);
		}
	});

	// After socket-events/more.ts prepended the page (import order in
	// socket-events/index.ts): the objects in `data.messages` are the ones
	// now in `channel.messages`, so their ids are store ids. The newest
	// `HISTORY_QUEUE_CAP` of the page are queued, newest first, one after
	// another so the queue's order is the order they were asked for.
	//
	// Two different things arrive as `more` (irc/history.ts `mode:
	// "prepend"`): the page MessageList asked for, and a channel's *first*
	// history fill when it is joined, which nobody asked for. Only the
	// first skips the switch-on moment — the reader is looking at that page
	// now; a join's fill is a replay like any other and must not translate
	// last week's scrollback. `historyLoading` tells them apart:
	// MessageList sets it immediately before its emit and
	// socket-events/more.ts clears it a tick after this listener has run.
	socket.on("more", (data) => {
		const target = store.getters.findChannel(data.chan);

		if (!target || !channelTranslation(target.network, target.channel).read) {
			return;
		}

		const asked = target.channel.historyLoading;

		void (async () => {
			for (const message of historyQueueOrder(data.messages)) {
				await translateMessage(
					target.network,
					target.channel,
					message,
					false,
					true,
					undefined,
					{history: asked}
				);
			}
		})();
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
		replays.delete(target.channel.id);
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

			for (const c of network.channels) {
				arrivals.delete(c.id);
				replays.delete(c.id);
			}
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
