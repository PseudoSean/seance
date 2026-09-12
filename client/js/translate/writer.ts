// The composer's glue (spec § Composer), the mirror of reader.ts and the
// other module allowed to import the store: the channel's write target,
// one draft's translation into store.state.outgoingTranslations (which
// ChatInput.vue renders as the strip), the round trip, and what a sent
// pair leaves behind (the user's voice for later prompts, a term for the
// channel's memory). The reading queue cannot serve a write and is held
// while one runs; the request goes to the service directly.

import {getBranding} from "../branding";
import socket from "../socket";
import {store, type OutgoingTranslation} from "../store";
import type {ClientChan, ClientNetwork} from "../types";
import {type Formality, channelKey, getChannelTranslation, rememberTerm} from "./channelStore";
import {buildContext} from "./context";
import {detectLanguage} from "./detect";
import {plainTextOf} from "./eligibility";
import {emptyContext} from "./engine";
import {translateService} from "./index";
import {
	ABORTED,
	type OutgoingDeps,
	reverseTarget,
	termPair,
	translateDraft,
	writeSource,
} from "./outgoing";
import {channelTranslation, holdReading, releaseReading, translationAvailable} from "./reader";

/** An id no message has: buildContext then takes the whole scrollback as "before" the draft. */
const DRAFT_ID = Number.MAX_SAFE_INTEGER;

/** In-flight translation and check per channel id. */
const sessions = new Map<number, AbortController>();
const checks = new Map<number, AbortController>();
/** The user's sent translations per channel, for the prompt's voice line (session only). */
const voices = new Map<number, {to: string; lines: string[]}>();
/** More than VOICE_LINES are kept so a target switch and back still has a few. */
const VOICE_KEEP = 10;

const deps: OutgoingDeps = {
	translate: (req, signal) => translateService().translate(req, signal),
	setTimeout: (fn, ms) => window.setTimeout(fn, ms),
	clearTimeout: (handle) => window.clearTimeout(handle as number),
};

/** The global setting is typed as a string (settings.ts derives it from its default). */
function asFormality(value: unknown): Formality {
	return value === "formal" || value === "casual" ? value : "auto";
}

export function writeTarget(network: ClientNetwork, channel: ClientChan): string | null {
	if (!translationAvailable()) {
		return null;
	}

	return channelTranslation(network, channel).write;
}

export function outgoingTranslation(channel: ClientChan): OutgoingTranslation | undefined {
	return store.state.outgoingTranslations[channel.id];
}

function voiceFor(channel: ClientChan, to: string): string[] {
	const voice = voices.get(channel.id);

	return voice && voice.to === to ? voice.lines : [];
}

/** Still the strip for this draft? A cancel or a newer draft replaces it. */
function current(channel: ClientChan, draft: string, controller: AbortController): boolean {
	return (
		!controller.signal.aborted && store.state.outgoingTranslations[channel.id]?.draft === draft
	);
}

/**
 * The first Enter: translate the draft into the channel's write target.
 * Resolves "strip" when the strip is up (the second Enter sends it, or
 * sends the draft as written after a failure) and "plain" when the draft
 * needs no translation — the detector already places it in the target —
 * so the caller sends it as typed.
 */
export async function translateOutgoing(
	network: ClientNetwork,
	channel: ClientChan,
	draft: string
): Promise<"strip" | "plain"> {
	const to = writeTarget(network, channel);

	if (!to) {
		return "plain";
	}

	cancelOutgoing(channel);

	const controller = new AbortController();

	sessions.set(channel.id, controller);
	store.commit("outgoingTranslationSet", {
		chanId: channel.id,
		value: {
			status: "pending",
			draft,
			text: "",
			from: null,
			to,
			error: null,
			check: {status: "idle", text: "", to: null},
		},
	});

	try {
		if (!store.state.translation.capability) {
			await translateService().capabilities();
		}

		const nicks = channel.users.map((u) => u.nick);
		// No channel prior: it describes what others write, and this is
		// the user's own line.
		const detection = await detectLanguage(plainTextOf(draft, nicks), null);

		if (!current(channel, draft, controller)) {
			return "strip";
		}

		// The panel may have changed while the detector loaded.
		const settings = channelTranslation(network, channel);

		if (settings.write !== to) {
			cancelOutgoing(channel);
			return "plain";
		}

		if (detection.lang === to) {
			cancelOutgoing(channel);
			return "plain";
		}

		const from = writeSource(detection.lang, store.state.settings.translateTo, to);
		const route = await translateService().route(from, to);
		const context = buildContext(
			channel,
			{
				id: DRAFT_ID,
				type: "message",
				text: draft,
				from: {nick: network.nick},
				replyTo: channel.replyTo?.msgid,
			},
			{
				translated(id) {
					const entry = store.state.translations[id];

					return entry && entry.status === "done" ? entry.text : undefined;
				},
				terms: settings.terms,
				glossary: getBranding().translation?.glossary ?? [],
				formality:
					settings.formality !== "auto"
						? settings.formality
						: asFormality(store.state.settings.translateFormality),
				variant: settings.variant,
				sourceHint: from,
				voice: voiceFor(channel, to),
			}
		);

		store.commit("outgoingTranslationPatch", {chanId: channel.id, patch: {from}});
		holdReading();

		let text: string;

		try {
			text = await translateDraft(
				deps,
				{
					text: draft,
					from,
					to,
					purpose: "write",
					context,
					batches: route?.candidate === "llm",
				},
				controller.signal,
				(partial) => {
					if (current(channel, draft, controller)) {
						store.commit("outgoingTranslationPatch", {
							chanId: channel.id,
							patch: {text: partial},
						});
					}
				}
			);
		} finally {
			releaseReading();
		}

		if (!current(channel, draft, controller)) {
			return "strip";
		}

		store.commit("outgoingTranslationPatch", {
			chanId: channel.id,
			patch: {status: "done", text},
		});

		if (store.state.settings.translateRoundTrip === "auto") {
			void checkOutgoing(network, channel);
		}

		return "strip";
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);

		if (message !== ABORTED && current(channel, draft, controller)) {
			store.commit("outgoingTranslationPatch", {
				chanId: channel.id,
				patch: {status: "failed", error: message},
			});
		}

		return "strip";
	} finally {
		if (sessions.get(channel.id) === controller) {
			sessions.delete(channel.id);
		}
	}
}

/** Escape, the strip's Edit, a changed draft, a send: the strip and its requests go. */
export function cancelOutgoing(channel: ClientChan): void {
	sessions.get(channel.id)?.abort();
	sessions.delete(channel.id);
	checks.get(channel.id)?.abort();
	checks.delete(channel.id);

	if (store.state.outgoingTranslations[channel.id]) {
		store.commit("outgoingTranslationRemove", channel.id);
	}
}

export function canCheckOutgoing(entry: OutgoingTranslation): boolean {
	return reverseTarget(entry.from, store.state.settings.translateTo, entry.to) !== null;
}

/** The round trip: the translation read back into the user's language, under the strip. */
export async function checkOutgoing(network: ClientNetwork, channel: ClientChan): Promise<void> {
	const entry = store.state.outgoingTranslations[channel.id];

	if (!entry || entry.status !== "done" || entry.check.status === "pending") {
		return;
	}

	const target = reverseTarget(entry.from, store.state.settings.translateTo, entry.to);

	if (!target) {
		return;
	}

	checks.get(channel.id)?.abort();

	const controller = new AbortController();
	const draft = entry.draft;

	checks.set(channel.id, controller);
	store.commit("outgoingTranslationPatch", {
		chanId: channel.id,
		patch: {check: {status: "pending", text: "", to: target}},
	});

	try {
		const route = await translateService().route(entry.to, target);
		const context = emptyContext();

		context.sourceHint = entry.to;

		const text = await translateDraft(
			deps,
			{
				text: entry.text,
				from: entry.to,
				to: target,
				purpose: "read",
				context,
				batches: route?.candidate === "llm",
			},
			controller.signal,
			(partial) => {
				if (current(channel, draft, controller)) {
					store.commit("outgoingTranslationPatch", {
						chanId: channel.id,
						patch: {check: {status: "pending", text: partial, to: target}},
					});
				}
			}
		);

		if (current(channel, draft, controller)) {
			store.commit("outgoingTranslationPatch", {
				chanId: channel.id,
				patch: {check: {status: "done", text, to: target}},
			});
		}
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);

		if (message !== ABORTED && current(channel, draft, controller)) {
			store.commit("outgoingTranslationPatch", {
				chanId: channel.id,
				patch: {check: {status: "failed", text: message, to: target}},
			});
		}
	} finally {
		if (checks.get(channel.id) === controller) {
			checks.delete(channel.id);
		}
	}
}

/**
 * A translation went out: it joins the voice quoted to the model next
 * time, and a term-sized pair joins the channel's memory (the store's copy
 * of the record is refreshed, like setChannelOptions does).
 */
export function noteOutgoingSent(
	network: ClientNetwork,
	channel: ClientChan,
	draft: string,
	translation: string,
	to: string
): void {
	const voice = voices.get(channel.id);

	if (voice && voice.to === to) {
		voice.lines = [...voice.lines, translation].slice(-VOICE_KEEP);
	} else {
		voices.set(channel.id, {to, lines: [translation]});
	}

	const pair = termPair(draft, translation);

	if (pair) {
		rememberTerm(network.uuid, channel.name, pair);
		store.commit("translateChannelSet", {
			key: channelKey(network.uuid, channel.name),
			value: getChannelTranslation(network.uuid, channel.name),
		});
	}
}

export function initWriter(): void {
	// Registered before socket-events/part.ts / quit.ts (import order), like
	// the reader's: a channel that goes takes its strip and requests with it.
	socket.on("part", (data) => {
		const target = store.getters.findChannel(data.chan);

		if (target) {
			cancelOutgoing(target.channel);
			voices.delete(target.channel.id);
		}
	});

	socket.on("quit", (data) => {
		const network = store.state.networks.find((n) => n.uuid === data.network);

		for (const channel of network?.channels ?? []) {
			cancelOutgoing(channel);
			voices.delete(channel.id);
		}
	});
}
