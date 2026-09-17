// The reading pipeline's glue (spec § Reading pipeline): one of the three
// modules — with index.ts and writer.ts — that import the store. A second
// `socket.on("msg")` listener (registered by
// socket-events/translate.ts after socket-events/msg.ts pushed the
// message) runs eligibility → detection → context → queue, and a second
// `socket.on("more")` does the same for a history page (newest first,
// capped), as does a replay batch and the requeue of a switch-on or a
// language change; the queue
// writes state.translations; the header globe and the panel call
// setReading/setChannelOptions; the chip and the toolbar call
// retranslate/showOriginal/retryTranslation.

import {watch} from "vue";

import {getBranding} from "../branding";
import {userLanguageRef} from "../i18n";
import socket from "../socket";
import {store, type TranslationEntry} from "../store";
import type {ClientChan, ClientMessage, ClientNetwork} from "../types";
import {
	type ChannelTranslation,
	channelKey,
	defaultChannelTranslation,
	effectiveFormality,
	forgetNetwork,
	loadAll,
	setChannelTranslation,
	termsFor,
} from "./channelStore";
import {buildContext} from "./context";
import {type Detection, LanguagePrior, detectLanguage, detectionSkip} from "./detect";
import {ReplayBatches, historyQueueOrder, isChatLine, isEligible, plainTextOf} from "./eligibility";
import {fromLocaleTag} from "./languages";
import {setTranslationUsage, translateService} from "./index";
import {NO_ROUTE, type QueueItem, type QueueUpdate, TranslateQueue} from "./queue";
import {sentReadBacks, takesReadBack} from "./sentReadBack";
import {protect, stripCopiedNickPrefix} from "./spans";

const queues = new Map<string, TranslateQueue>();
const priors = new Map<string, LanguagePrior>();
const arrivals = new Map<number, number>();
/**
 * Per channel id, bumped whenever its reading restarts (switched on, off,
 * or to another language) or the channel goes: a history run or a
 * detection still under way for the old state stops rather than queueing
 * into the new one — twice, or into a channel that is no longer there.
 */
const generations = new Map<number, number>();
/**
 * The last item queued per message, for retries. `unsure` marks one queued
 * only because the detector could not place it (not a forced request): with
 * no engine for an unnamed source it becomes the unsure mark, not a failure.
 */
const items = new Map<number, {network: string; item: QueueItem; unsure?: boolean}>();

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

/**
 * The language the user reads in: the interface's (`userLanguageRef`, the
 * one language setting — the Settings → Translation select and the dev
 * sidebar's globe both write it; `fromLocaleTag` maps it to a translation
 * code). The one decision for everything that needs it: the queues
 * translate into it, the composer (`writer.ts`) places a draft it cannot
 * detect and reads a translation back into it, and the labels
 * (`TranslationLine.vue`, the composer strip, the channel header's
 * translate button) name their languages in it. Reading itself is on or
 * off per channel (`setReading`); the language is not, so a draft can no
 * longer meet a panel language that differs from this one.
 */
export function readingLanguage(): string {
	return fromLocaleTag(userLanguageRef.value);
}

/**
 * The reading language changed (the Settings override moved, or the
 * interface's did and the override follows it): re-read every channel that
 * is reading, the way a switch-on does (`requeueReading` -- not
 * `setReading`, which is already on and would return at its no-op guard).
 * A change that leaves the effective language alone restarts nothing; the
 * language the reader is initialised with is the one to measure the first
 * change against, so it is recorded there rather than guessed at here.
 */
let lastReadingLanguage: string | null = null;

function restartAllReading(): void {
	const next = readingLanguage();

	if (next === lastReadingLanguage) {
		return;
	}

	lastReadingLanguage = next;

	for (const network of store.state.networks) {
		for (const channel of network.channels) {
			if (channelTranslation(network, channel).read) {
				requeueReading(network, channel);
			}
		}
	}
}

watch(userLanguageRef, restartAllReading);

/**
 * Whether translation is wanted right now (service.ts `setInUse`): a
 * composer strip open (with its read-back), a line waiting in a queue, or a
 * channel still in the store reading or writing through it. A channel that
 * was left keeps its setting for a rejoin but wants nothing meanwhile. When
 * none is, and nothing is in flight, the models unload at once.
 */
export function translationInUse(): boolean {
	if (Object.keys(store.state.outgoingTranslations).length > 0) {
		return true;
	}

	if ([...queues.values()].some((queue) => queue.size() > 0)) {
		return true;
	}

	return store.state.networks.some((network) =>
		network.channels.some((channel) => {
			const setting = channelTranslation(network, channel);

			return !!setting.read || !!setting.write;
		})
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

function generationOf(chanId: number): number {
	return generations.get(chanId) ?? 0;
}

/** Still the reading the caller started under, in a channel still in the store. */
function stillCurrent(chanId: number, generation: number): boolean {
	return generationOf(chanId) === generation && !!store.getters.findChannel(chanId);
}

/**
 * Queue a load of history lines, in the order given (newest first,
 * `historyQueueOrder`), one after another so the queue's order is that
 * order: a history page, a replay batch, or the requeue of a switch-on or a
 * language change. Every line still goes through eligibility and detection.
 */
async function queueHistory(
	network: ClientNetwork,
	channel: ClientChan,
	newestFirst: readonly ClientMessage[]
): Promise<void> {
	const generation = generationOf(channel.id);

	for (const message of newestFirst) {
		if (!stillCurrent(channel.id, generation)) {
			return;
		}

		await translateMessage(network, channel, message, false, true);
	}
}

/**
 * A replay's lines grouped into the batch that brought them (eligibility.ts
 * `ReplayBatches`): each batch of a catch-up or a bouncer replay queues at
 * most `HISTORY_QUEUE_CAP` of its lines, newest first.
 */
const replayBatches = new ReplayBatches<ClientMessage>((chanId, newestFirst) => {
	const target = store.getters.findChannel(chanId);

	if (target) {
		void queueHistory(target.network, target.channel, newestFirst);
	}
});

function queueFor(network: ClientNetwork): TranslateQueue {
	let queue = queues.get(network.uuid);

	if (!queue) {
		const service = translateService();

		queue = new TranslateQueue({
			route: (from, to, hint) =>
				service.route(from, to, hint).then((route) => route?.ref.engine ?? null),
			translate: (req, signal) => service.translate(req, signal),
			loadTicks: () => service.loadTicks(),
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

	// A line leaving the queue may be the last thing translation was wanted
	// for (queue sizes are not store state, so the watch in index.ts cannot see it).
	if (update.status !== "pending") {
		translateService().usageChanged();
	}

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
			// A line queued with its source left to the engine because the
			// detector could not place it, and no engine takes an unnamed
			// source (a CPU-only device): what it would otherwise have been is
			// the unsure mark, not a failure nobody asked for.
			if (update.error === NO_ROUTE && known?.unsure) {
				items.delete(id);
				store.commit("translationPatch", {
					id,
					patch: {status: "skipped", reason: "unsure", from: "", error: null},
				});
				break;
			}

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

/**
 * Messages that are gone for good -- a trim, a cleared history, a redaction,
 * an edit's original -- take the pipeline's memory of them with them. The
 * store's own `translationRemove`/`translationRemoveMany` drops the
 * translation; this drops the queue item the chip's retry would have reused,
 * which is keyed by the same message id and could never be reached again.
 */
export function forgetTranslations(ids: readonly number[]): void {
	for (const id of ids) {
		items.delete(id);
	}
}

function commitChannel(
	network: ClientNetwork,
	channel: ClientChan,
	value: ChannelTranslation
): void {
	store.commit("translateChannelSet", {key: channelKey(network.uuid, channel.name), value});
}

/**
 * Turn reading on or off for a channel. Off cancels what is queued; on
 * starts the channel over on what it shows (`requeueReading`). The same
 * setting again changes nothing.
 */
export function setReading(network: ClientNetwork, channel: ClientChan, on: boolean): void {
	const before = channelTranslation(network, channel).read;
	const value = setChannelTranslation(network.uuid, channel.name, {read: on});

	commitChannel(network, channel, value);

	if (on === before) {
		return;
	}

	if (!on) {
		generations.set(channel.id, generationOf(channel.id) + 1);
		replayBatches.drop(channel.id);
		queues.get(network.uuid)?.cancelChannel(channel.id);
		return;
	}

	requeueReading(network, channel);
}

/**
 * Start a reading channel over on what it shows: its queued work and
 * translations go, its language prior with them, and its messages are
 * queued again, newest first and capped like a history load. Both ways
 * into a fresh read go through here -- a switch-on, and a change of the
 * reading language (`restartAllReading`), which leaves the switch alone
 * and so never reaches `setReading`'s body.
 *
 * Own lines go with the rest and are queued again like anyone's. The one
 * exception is an own line whose translation is already in the new language
 * -- a posted line's read-back (writer.ts) -- which is kept, and which the
 * requeue then leaves alone rather than translating it a second time.
 */
export function requeueReading(network: ClientNetwork, channel: ClientChan): void {
	generations.set(channel.id, generationOf(channel.id) + 1);
	replayBatches.drop(channel.id);
	queues.get(network.uuid)?.cancelChannel(channel.id);

	// The language is the global reading language (the interface's, or the
	// Settings override): only a finished translation already in it is
	// kept, a skipped mark is detected again like everything else.
	const lang = readingLanguage();

	forgetItems(({item}) => item.chanId === channel.id);

	const requeued = channel.messages.filter((m) => {
		const entry = store.state.translations[m.id];

		return !(m.self && entry?.status === "done" && entry.to === lang);
	});

	store.commit(
		"translationRemoveMany",
		requeued.map((m) => m.id)
	);
	priors.delete(channelKey(network.uuid, channel.name));
	void queueHistory(network, channel, historyQueueOrder(requeued));
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

/**
 * A line detection left alone gets a mark (`TranslationLine.vue`: the
 * language it was taken for, or "?"), so a reader can tell it from a line
 * nothing looked at, and translate it anyway from the mark's menu. A
 * translation already there or on its way is never replaced by one.
 */
function markSkipped(
	id: number,
	reason: "same" | "unsure",
	to: string,
	detection: Detection
): void {
	const existing = store.state.translations[id];

	if (existing && (existing.status === "done" || existing.status === "pending")) {
		return;
	}

	store.commit("translationEntry", {
		id,
		entry: {
			status: "skipped",
			reason,
			text: "",
			from: reason === "same" ? to : "",
			to,
			candidates: detection.candidates,
			engine: null,
			error: null,
			hidden: false,
		},
	});
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
 * However old a line is, it is considered: reading covers what the channel
 * shows, and history is bounded per load by its callers instead.
 */
export async function translateMessage(
	network: ClientNetwork,
	channel: ClientChan,
	message: ClientMessage,
	force = false,
	replay = false,
	from?: string
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
	const generation = generationOf(channel.id);

	if (!force && (!initial.read || !isEligible(message, {nicks}))) {
		return;
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
				exclude: readingLanguage(),
		  });

	// Detection (the first call also awaits the franc chunk download) can
	// take a while: re-read the switch afterwards, since a switch-off or a
	// target change during that wait must not still ship a translation (a
	// target change queues the channel again itself), and a channel left
	// meanwhile keeps its setting but has nothing to show a translation in.
	const settings = channelTranslation(network, channel);

	if (!store.getters.findChannel(channel.id)) {
		return;
	}

	if (!force && (!settings.read || generationOf(channel.id) !== generation)) {
		return;
	}

	const to = readingLanguage();

	// Placed in the reading language, or not placed with the reading language
	// among the contenders: left alone (detect.ts `detectionSkip`) and
	// marked. A line the detector could not place is otherwise translated
	// with its source left to the engine.
	const skip = force ? null : detectionSkip(detection, to);

	if (skip) {
		markSkipped(message.id, skip, to, detection);
		return;
	}

	// A chosen source is used as it stands, even when it is the target: the
	// reader asked for that translation.
	const source = from ?? (detection.lang && detection.lang !== to ? detection.lang : null);
	// Not placed: the prompt says nothing about the source and the router gets
	// no hint (the item's `context.sourceHint` is both). The channel's prior
	// is no better a guess -- a Spanish line in a German channel would be
	// announced as "probably German" -- and a weak guess would send the line
	// to a seq2seq model with the wrong source, where the LLM places it itself.
	const unsure = detection.lang === null;
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
			terms: termsFor(settings.terms, source, to),
			glossary: getBranding().translation?.glossary ?? [],
			// The channel's register, or the global one where it says "auto":
			// the same fallback the composer uses (channelStore.ts).
			formality: effectiveFormality(
				settings.formality,
				store.state.settings.translateFormality
			),
			variant: settings.variant,
			sourceHint: source ?? (unsure ? null : prior.top()),
		}),
		arrivalsAtEnqueue: arrivals.get(channel.id) ?? 0,
		single: force,
		// A history line waits behind the channel's live ones (queue.ts): what
		// is being said now matters more than what was said then. A forced
		// request is never history, however old the line is — someone asked.
		...(!force && replay ? {history: true as const} : {}),
	};

	items.set(message.id, {network: network.uuid, item, unsure: unsure && !force});
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

/**
 * The source a rebuilt retry keeps: the failed line's own, never a skipped
 * mark's (a `same` mark's `from` is the reading language itself).
 */
function retrySource(entry: TranslationEntry | undefined): string | undefined {
	return entry && entry.status !== "skipped" && entry.from ? entry.from : undefined;
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
		retranslate(network, channel, message, retrySource(store.state.translations[message.id]));
	}
}

export function initReader(): void {
	store.commit("translateChannelsLoaded", loadAll());
	setTranslationUsage(translationInUse);
	// The language reading starts in: the first change after boot is measured
	// against this, so it counts like any other.
	lastReadingLanguage = readingLanguage();

	// After socket-events/msg.ts pushed the message (import order in
	// socket-events/index.ts): the object in `data.msg` is the one in
	// `channel.messages`, so its id is the store id.
	socket.on("msg", (data) => {
		const target = store.getters.findChannel(data.chan);

		if (!target) {
			return;
		}

		// What the channel has said since a line was queued, which is how the
		// queue decides a translation has been left behind: only lines
		// someone said count, never a join, a quit or a mode.
		if (isChatLine(data.msg)) {
			arrivals.set(target.channel.id, (arrivals.get(target.channel.id) ?? 0) + 1);
		}

		if (!channelTranslation(target.network, target.channel).read) {
			return;
		}

		// A replayed line (a reconnect's catch-up, a bouncer replay) waits
		// for the rest of its batch, so the batch is queued newest first and
		// capped like a history page: a reload of a channel that has been on
		// for a week does not queue a week.
		if (data.replay) {
			replayBatches.add(target.channel.id, data.msg);
		} else {
			// A posted translation keeps the composer's read-back rather than
			// being translated again (sentReadBack.ts `takesReadBack`): checked
			// here, synchronously in the dispatch, so it holds whichever of
			// this listener and the writer's runs first.
			if (
				takesReadBack(
					sentReadBacks,
					target.channel.id,
					data.msg,
					false,
					// A skipped mark is no translation to keep.
					!!store.state.translations[data.msg.id] &&
						store.state.translations[data.msg.id].status !== "skipped",
					Date.now()
				)
			) {
				return;
			}

			void translateMessage(target.network, target.channel, data.msg);
		}
	});

	// After socket-events/more.ts prepended the page (import order in
	// socket-events/index.ts): the objects in `data.messages` are the ones
	// now in `channel.messages`, so their ids are store ids. Both things
	// that arrive as `more` (irc/history.ts `mode: "prepend"`) -- the page
	// MessageList asked for and a channel's first history fill on joining
	// it -- are a load like any other: the newest `HISTORY_QUEUE_CAP` of the
	// page, newest first.
	socket.on("more", (data) => {
		const target = store.getters.findChannel(data.chan);

		if (!target || !channelTranslation(target.network, target.channel).read) {
			return;
		}

		void queueHistory(target.network, target.channel, historyQueueOrder(data.messages));
	});

	// Registered before socket-events/part.ts (import order), so the
	// channel is still in the store when this runs. The channel's setting
	// stays (channelStore and state.translateChannels): a rejoin finds
	// reading still on, in the same language, and translates the history
	// the join loads. What goes is this channel object's work: its queue,
	// counters, remembered items and the translations of its messages.
	socket.on("part", (data) => {
		const target = store.getters.findChannel(data.chan);

		if (!target) {
			return;
		}

		queues.get(target.network.uuid)?.cancelChannel(target.channel.id);
		priors.delete(channelKey(target.network.uuid, target.channel.name));
		arrivals.delete(target.channel.id);
		generations.delete(target.channel.id);
		replayBatches.drop(target.channel.id);
		forgetItems(({item}) => item.chanId === target.channel.id);
		store.commit(
			"translationRemoveMany",
			target.channel.messages.map((m) => m.id)
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
				generations.delete(c.id);
				replayBatches.drop(c.id);
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
