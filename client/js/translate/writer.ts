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
import {type EngineName, emptyContext} from "./engine";
import {translateService} from "./index";
import {
	ABORTED,
	EMPTY_TRANSLATION,
	type OutgoingDeps,
	UNCHANGED,
	WRITE_DETECT_MIN_GAP,
	hasNoLetters,
	isUnchanged,
	reverseTarget,
	termPair,
	translateDraft,
	writeSource,
} from "./outgoing";
import {channelTranslation, holdReading, releaseReading} from "./reader";
import type {Route} from "./router";
import {LLM_MARKERS, type MarkerForm, stripCopiedNickPrefix} from "./spans";

/** An id no message has: buildContext then takes the whole scrollback as "before" the draft. */
const DRAFT_ID = Number.MAX_SAFE_INTEGER;

/**
 * The marker form a route's engine reads (spans.ts): the LLM is the one
 * that takes an instruction about the marks and the one that cannot handle
 * placeholders around words it must translate, so it gets `LLM_MARKERS`;
 * every seq2seq candidate keeps the numbered pairs.
 */
function markersFor(candidate: string | undefined): MarkerForm {
	return candidate === "llm" ? LLM_MARKERS : "placeholder";
}

/**
 * Which of the two engines a route runs on (`models.ts` `Candidate` names
 * the model, `engine.ts` `EngineName` the engine behind it): the strip's
 * title says GPU or CPU off this, so a user looking at a translation can
 * see which one they got.
 */
function engineFor(route: Route | null): EngineName | null {
	if (!route) {
		return null;
	}

	return route.candidate === "llm" ? "llm" : "seq2seq";
}

/**
 * The language the user reads this channel in -- the channel's own panel
 * setting, the global one only as the fallback for a channel whose reading
 * is off. The reader decides the same way (`reader.ts`), and it has to be
 * the same decision: a composer that read the global alone would take a
 * draft it could not place as written in the write target whenever the
 * panel read English while the global still named German, and ask for a
 * translation from German into German -- which the model answers by handing
 * the line back untranslated.
 */
function readingLanguage(network: ClientNetwork, channel: ClientChan): string {
	return channelTranslation(network, channel).read ?? store.state.settings.translateTo;
}

/** In-flight translation and check per channel id. */
const sessions = new Map<number, AbortController>();
const checks = new Map<number, AbortController>();
/** The user's sent translations per channel, for the prompt's voice line (session only). */
const voices = new Map<number, {to: string; lines: string[]}>();
/**
 * How many sent translations a channel remembers for one target (a send to
 * a different target replaces the lot); buildContext quotes the newest
 * VOICE_LINES of them, so the surplus is only margin.
 */
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

/**
 * The channel's write target, synchronously, for a component to render off.
 * It does not wait for the device probe — the panel is the only writer of
 * `write`, and a placeholder that says "sent in German" a moment before the
 * probe answers is better than a draft that goes out untranslated because
 * the capability was not known yet. translateOutgoing awaits the probe and
 * judges availability there.
 */
export function writeTarget(network: ClientNetwork, channel: ClientChan): string | null {
	return translateService().enabled ? channelTranslation(network, channel).write : null;
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
 * Resolves "plain" when the draft needs no translation — there is no write
 * target, the device cannot translate, or the detector already places the
 * draft in the target — so the caller sends it as typed. Resolves "strip"
 * when the strip is up (the second Enter sends it, or sends the draft as
 * written after a failure) and when a strip was dropped mid-flight (a newer
 * draft, a cancel, the panel's target moved): nothing is sent, the draft
 * stays in the input.
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
			engine: null,
			model: null,
			error: null,
			check: {status: "idle", text: "", to: null},
		},
	});

	try {
		// The probe before the verdict: on a cold page the service is
		// created by this very call and its tier is not known yet, so
		// judging availability first would send every first draft
		// untranslated. The awaited value is the verdict — reading it back
		// out of the store would depend on index.ts chaining its commit onto
		// this same promise first. The probe is memoised, so this is free
		// once it has answered.
		const capability = await translateService().capabilities();

		if (!current(channel, draft, controller)) {
			return "strip";
		}

		if (!translateService().enabled || capability.tier === "none") {
			cancelOutgoing(channel);
			return "plain";
		}

		const nicks = channel.users.map((u) => u.nick);
		// No channel prior and no declared languages: both describe what
		// others write here, and this is the user's own line.
		const detection = await detectLanguage(plainTextOf(draft, nicks), null, []);

		if (!current(channel, draft, controller)) {
			return "strip";
		}

		// The panel may have changed while the detector loaded. The strip
		// this draft was started for is gone, so nothing is sent: the draft
		// stays in the input for the user's next Enter, which translates it
		// into the new target.
		const settings = channelTranslation(network, channel);

		if (settings.write !== to) {
			cancelOutgoing(channel);
			return "strip";
		}

		if (detection.lang === to && detection.confidence >= WRITE_DETECT_MIN_GAP) {
			cancelOutgoing(channel);
			return "plain";
		}

		const from = writeSource(detection, readingLanguage(network, channel), to);
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

		if (current(channel, draft, controller)) {
			store.commit("outgoingTranslationPatch", {
				chanId: channel.id,
				patch: {from, engine: engineFor(route), model: route?.ref.id ?? null},
			});
		}

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
					markers: markersFor(route?.candidate),
					nicks,
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

		// The prompt shows the earlier lines as `nick: text`, so a model can
		// copy a name in that shape in front of its answer. Only the finished
		// text is cleaned: a stream's prefix is not one until the line after
		// it has arrived — and a draft that opened with `nick: ` keeps it,
		// since then the prefix is the user's own.
		text = stripCopiedNickPrefix(text, draft, nicks);

		// An answer with nothing in it a language could be is a failure, not
		// a message: the strip says so and offers the draft as written, where
		// a "done" of "" would be sent as an empty line — which the IRC layer
		// drops in silence, taking the draft with it. A model given an
		// English line in the write shape answered `⟹ ⟦1⟧` on the offline
		// runner, which restores to `⟹ `, so "" is not the only way to get
		// nothing back.
		if (hasNoLetters(text)) {
			store.commit("outgoingTranslationPatch", {
				chanId: channel.id,
				patch: {status: "failed", error: EMPTY_TRANSLATION},
			});

			return "strip";
		}

		// The draft back again is not a translation either. No `from !== to`
		// guard is needed for it: `writeSource` no longer names the target,
		// so an echo here is the model declining — a line with nothing to
		// translate ("ok, brb") as much as one it would not touch. The offer
		// is the same as any failure's, and it is the right one: the second
		// Enter sends the draft as written.
		if (isUnchanged(draft, text)) {
			store.commit("outgoingTranslationPatch", {
				chanId: channel.id,
				patch: {status: "failed", error: UNCHANGED},
			});

			return "strip";
		}

		store.commit("outgoingTranslationPatch", {
			chanId: channel.id,
			patch: {status: "done", text},
		});

		void checkOutgoing(network, channel);

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

/** The round trip: the translation read back into the user's language, under the strip. */
export async function checkOutgoing(network: ClientNetwork, channel: ClientChan): Promise<void> {
	const entry = store.state.outgoingTranslations[channel.id];

	if (!entry || entry.status !== "done" || entry.check.status === "pending") {
		return;
	}

	const target = reverseTarget(readingLanguage(network, channel), entry.to);

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

		// Held like the translation itself: Send waits for this check, so it
		// must not queue behind the channel's incoming traffic either.
		holdReading();

		let text: string;

		try {
			text = await translateDraft(
				deps,
				{
					text: entry.text,
					from: entry.to,
					to: target,
					purpose: "read",
					context,
					batches: route?.candidate === "llm",
					markers: markersFor(route?.candidate),
					nicks: channel.users.map((u) => u.nick),
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
		} finally {
			releaseReading();
		}

		if (current(channel, draft, controller)) {
			// Read back from the translation, so that is the source the
			// prefix rule is judged against.
			const read = stripCopiedNickPrefix(
				text,
				entry.text,
				channel.users.map((u) => u.nick)
			);

			// Nothing a language could be is no read-back: the row would
			// otherwise offer `⟹ ` as what the translation says. The check's
			// own failed state ("couldn't check") is what a thrown error
			// gives, so that is the path it takes.
			if (hasNoLetters(read)) {
				throw new Error(EMPTY_TRANSLATION);
			}

			store.commit("outgoingTranslationPatch", {
				chanId: channel.id,
				patch: {check: {status: "done", text: read, to: target}},
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
	// The line the model handed back, and one with nothing in it a language
	// could be, are not the user's voice: a voice line in the wrong language
	// is quoted into every later prompt, which teaches the model to answer
	// in it. termPair refuses the same pairs.
	if (!isUnchanged(draft, translation) && !hasNoLetters(translation)) {
		const voice = voices.get(channel.id);

		if (voice && voice.to === to) {
			voice.lines = [...voice.lines, translation].slice(-VOICE_KEEP);
		} else {
			voices.set(channel.id, {to, lines: [translation]});
		}
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
