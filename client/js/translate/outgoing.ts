// The composer's translation (spec § Composer), Vue-free and store-free:
// the gate, one draft translated as a unit — a multi-line draft as
// numbered lines so its line count survives — the languages of the round
// trip, and the rule for what a sent pair leaves in term memory. writer.ts
// is the store glue around it; ChatInput.vue renders the strip.

import type {PromptContext, TranslateChunk, TranslateRequest} from "./engine";
import {parseBatchedOutput, stripSentinel} from "./prompt";
import {
	type MarkerForm,
	type Protected,
	placeholdersIn,
	protect,
	restore,
	restoreAll,
} from "./spans";

/** A draft's translation is given up after this long (the queue's limit). */
export const WRITE_TIMEOUT_MS = 2 * 60 * 1000;
/** A draft this short (words) whose translation is also short is a term worth remembering. */
export const TERM_MAX_WORDS = 3;
export const TERM_MAX_CHARS = 40;
/**
 * How sure the detector must be (its best guess's lead over the runner-up,
 * `detect.ts` `Detection.confidence`) before the composer trusts it over the
 * user's reading language: three times the reading side's `DETECT_MIN_GAP`
 * (0.1), because a wrong source here sends the draft to the LLM in the
 * wrong language rather than just skipping a translation.
 */
export const WRITE_DETECT_MIN_GAP = 0.3;
export const TIMED_OUT = "timed out";
export const ABORTED = "aborted";
/**
 * The two failures that are the *answer's* rather than the engine's
 * (`writer.ts`, `queue.ts`): the engine completed, so neither marks a
 * candidate down or counts toward the queue's pause.
 */
export const UNCHANGED = "came back unchanged";
export const EMPTY_TRANSLATION = "empty translation";

export type DraftGate = "empty" | "command" | "edit" | "ok";

/**
 * What the first Enter does with a draft. A slash command never translates
 * (`//text` is the text `/text`, so it does); neither does a message edit —
 * startEdit pre-fills the draft with the sent text, already in the write
 * language.
 */
export function draftGate(text: string, editing: boolean): DraftGate {
	if (text.trim().length === 0) {
		return "empty";
	}

	if (editing) {
		return "edit";
	}

	if (text[0] === "/" && text[1] !== "/") {
		return "command";
	}

	return "ok";
}

/**
 * The source language sent with a write. A draft too short to place
 * (`detection.lang === null`) is taken as the user's reading language when
 * that differs from the target, else left to the LLM. A draft the detector
 * places in the reading language is trusted outright. A draft the detector
 * places somewhere else is trusted only when it is sure enough
 * (`WRITE_DETECT_MIN_GAP`) -- a weak verdict is more likely the detector
 * misplacing a short draft than the user actually switching languages, so
 * it falls back to the reading language rather than sending the draft to
 * the LLM under a source it probably is not.
 *
 * A fallback is never the target. "From German into German" is a request
 * the model answers by handing the line back -- measured -- so where the
 * reading language is the write target there is nothing to fall back to and
 * the source is left to the LLM. A draft the detector places in the target
 * with a strong verdict never reaches here: the caller sends it as typed.
 */
export function writeSource(
	detection: {lang: string | null; confidence: number},
	readingLanguage: string,
	writeTarget: string
): string | null {
	const fallback = readingLanguage !== writeTarget ? readingLanguage : null;

	if (!detection.lang) {
		return fallback;
	}

	// A verdict that agrees with the reading language is trusted outright —
	// unless that language is the target, where a weak verdict (the strong
	// one was sent as typed by the caller) is still no source: the target
	// is never named as the source, whichever branch would have named it.
	if (detection.lang === readingLanguage) {
		return fallback;
	}

	return detection.confidence >= WRITE_DETECT_MIN_GAP ? detection.lang : fallback;
}

/**
 * The language a translation is read back into: the user's reading
 * language, or null when it is the same as the write target (nothing to
 * read back into). The draft's detected source plays no part -- the
 * read-back is always for the person reading, in the language they read.
 */
export function reverseTarget(readingLanguage: string, writeTarget: string): string | null {
	return readingLanguage !== writeTarget ? readingLanguage : null;
}

/** What two texts are compared as by `isUnchanged`: the differences a model
 *  makes to a line it is handing back rather than translating. */
function echoForm(text: string): string {
	return text
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[.,!?…]+$/, "")
		.trim();
}

/**
 * The answer is the source over again: the model echoed instead of
 * translating. That is what a request whose source was its own target
 * produced (`writeSource` no longer builds one), and it is what a model
 * does with a line that has nothing to translate -- "ok, brb", a bare nick.
 * Judged loosely on purpose: an answer differing only in case, in spacing
 * or in the full stop it dropped is still the line that went in.
 */
export function isUnchanged(source: string, translation: string): boolean {
	return echoForm(source) === echoForm(translation);
}

/**
 * Nothing in it a language could be -- `""`, `⟹ `, `⟦1⟧`, `--- ---`. A
 * model asked for a line with nothing to translate answers with punctuation
 * alone often enough to matter (`⟹ ⟦1⟧` was measured on the offline runner
 * for an English line in the write shape). Letters and digits of any script
 * are content, so `ok`, `42` and `Hallo` are answers; a placeholder is
 * span syntax rather than content, so its digit does not count (the same
 * strip `isProtectedOnly` does below -- restoration never leaves one, so
 * this only matters to a caller holding a protected text).
 */
export function hasNoLetters(text: string): boolean {
	return !/[\p{L}\p{N}]/u.test(text.replace(/⟦\s*\d+\s*⟧/g, ""));
}

function wordCount(text: string): number {
	return text.split(/\s+/).filter((w) => w !== "").length;
}

/**
 * The pair a sent translation leaves in the channel's term memory, or
 * null: only a term-sized draft (one line, at most TERM_MAX_WORDS words and
 * TERM_MAX_CHARS characters) with a short translation that differs from
 * it. Sentences would fill TERM_CAP and poison every later prompt's Terms
 * line.
 */
export function termPair(draft: string, translation: string): [string, string] | null {
	const source = draft.trim();
	const target = translation.trim();

	if (source.includes("\n") || target.includes("\n")) {
		return null;
	}

	if (source.length === 0 || source.length > TERM_MAX_CHARS || target.length > TERM_MAX_CHARS) {
		return null;
	}

	if (wordCount(source) > TERM_MAX_WORDS || wordCount(target) > TERM_MAX_WORDS * 2) {
		return null;
	}

	if (source.startsWith("/") || source.includes("⟦") || target.includes("⟦")) {
		return null;
	}

	// A side with nothing in it a language could be is no term: an answer of
	// punctuation alone would be quoted into every later prompt as the
	// translation of a real word.
	if (hasNoLetters(source) || hasNoLetters(target)) {
		return null;
	}

	if (source.toLowerCase() === target.toLowerCase()) {
		return null;
	}

	return [source, target];
}

export interface OutgoingDeps {
	translate(
		req: Omit<TranslateRequest, "id" | "model">,
		signal: AbortSignal
	): AsyncIterable<TranslateChunk>;
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface OutgoingRequest {
	/** The draft as typed: unprotected, may carry newlines. */
	text: string;
	from: string | null;
	to: string;
	purpose: "write" | "read";
	context: PromptContext;
	/** The route's engine takes numbered lines (the LLM does; seq2seq does not). */
	batches: boolean;
	/** The channel's names, protected like any other span (spans.ts). */
	nicks?: string[];
	/**
	 * The marker form the route's engine reads (spans.ts `renderMarkers`):
	 * `LLM_MARKERS` on the LLM route, `placeholder` everywhere else. It
	 * travels with the request as well as into the protection, so the
	 * prompt can say what the text it is looking at carries.
	 */
	markers?: MarkerForm;
	/**
	 * Already protected, `text` being its protected form: the reading queue
	 * protects a whole message once (a fenced block is one span across its
	 * lines) and hands the lines here. Without it the text is protected
	 * here — once, before it is split, for the same reason.
	 */
	protected?: Protected;
}

/** Nothing here but placeholders: a fenced code block's line, say. */
function isProtectedOnly(line: string): boolean {
	return placeholdersIn(line).length > 0 && line.replace(/⟦\s*\d+\s*⟧/g, "").trim() === "";
}

/** One translation of the already-protected `line`, streamed through `onChunk` (restored). */
async function translateOne(
	deps: OutgoingDeps,
	request: OutgoingRequest,
	info: Protected,
	line: string,
	signal: AbortSignal,
	onChunk: (text: string) => void
): Promise<string> {
	let last = "";

	for await (const chunk of deps.translate(
		{
			text: line,
			from: request.from,
			to: request.to,
			purpose: request.purpose,
			context: request.context,
			markers: request.markers,
		},
		signal
	)) {
		last = chunk.text;
		onChunk(restore(chunk.text, info.spans).text);
	}

	return restoreAll(last, info, placeholdersIn(line));
}

/** The numbered stream as it stands, numbers stripped and spans restored, for the strip. */
function batchedPreview(raw: string, info: Protected): string {
	return stripSentinel(raw)
		.split("\n")
		.map((line) => {
			const match = /^\s*\d+\.\s?(.*)$/.exec(line);

			return restore(match ? match[1] : line, info.spans).text;
		})
		.join("\n");
}

/**
 * The non-blank lines of a multi-line draft as one numbered request; null
 * when the answer's numbering does not parse (the caller then goes line by
 * line).
 */
async function translateBatched(
	deps: OutgoingDeps,
	request: OutgoingRequest,
	info: Protected,
	lines: string[],
	signal: AbortSignal,
	onChunk: (text: string) => void
): Promise<string[] | null> {
	let last = "";

	for await (const chunk of deps.translate(
		{
			text: "",
			lines,
			from: request.from,
			to: request.to,
			purpose: request.purpose,
			context: request.context,
			markers: request.markers,
		},
		signal
	)) {
		last = chunk.text;
		onChunk(batchedPreview(chunk.text, info));
	}

	const parsed = parseBatchedOutput(last, lines.length);

	if (!parsed) {
		return null;
	}

	return parsed.map((text, i) => restoreAll(text, info, placeholdersIn(lines[i])));
}

/**
 * Translate a text as a unit — the composer's draft, and (through the
 * queue) a multi-line message someone sent. The whole text is protected
 * once and only then split, so a fenced block is one span rather than a
 * fence per line, and a line that holds nothing but a placeholder is put
 * back rather than translated. Resolves the translation with the text's
 * line structure (blank lines in place); rejects with TIMED_OUT after
 * WRITE_TIMEOUT_MS, ABORTED when `signal` aborts, or the engine's error.
 * `onChunk` gets the text so far, restored, for the strip to stream.
 */
export async function translateDraft(
	deps: OutgoingDeps,
	request: OutgoingRequest,
	signal: AbortSignal,
	onChunk: (text: string) => void
): Promise<string> {
	const controller = new AbortController();
	const abort = () => controller.abort();
	let timedOut = false;

	if (signal.aborted) {
		throw new Error(ABORTED);
	}

	signal.addEventListener("abort", abort, {once: true});

	const timer = deps.setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, WRITE_TIMEOUT_MS);

	// A stream that ended because of the timeout or the caller's abort ends
	// normally (client.ts closes it at once), so the result is checked, not
	// trusted.
	const finish = (text: string): string => {
		if (timedOut) {
			throw new Error(TIMED_OUT);
		}

		if (signal.aborted) {
			throw new Error(ABORTED);
		}

		return text;
	};

	try {
		// Once, on the whole text: a fenced code block is one span across
		// its lines, and a placeholder's number is the same in every line.
		const info =
			request.protected ??
			protect(request.text, {nicks: request.nicks, markers: request.markers});
		const lines = info.text.split("\n");
		const filled: [string, number][] = [];
		// A line that is nothing but protected syntax (a code block) has
		// nothing to translate: it is put back as it was.
		const kept: number[] = [];

		lines.forEach((line, index) => {
			if (line.trim() === "") {
				return;
			}

			if (isProtectedOnly(line)) {
				kept.push(index);
				return;
			}

			filled.push([line, index]);
		});

		if (filled.length <= 1 && kept.length === 0) {
			const only = filled.length === 1 ? filled[0][0] : info.text;
			const text = await translateOne(deps, request, info, only, controller.signal, onChunk);

			return finish(text);
		}

		const out = [...lines];

		for (const index of kept) {
			out[index] = restoreAll(lines[index], info, placeholdersIn(lines[index]));
		}

		let translated: string[] | null = null;

		if (request.batches && filled.length > 1) {
			let streamed = false;

			try {
				translated = await translateBatched(
					deps,
					request,
					info,
					filled.map(([l]) => l),
					controller.signal,
					(preview) => {
						streamed = true;

						const partial = preview.split("\n");

						filled.forEach(([, index], n) => {
							out[index] = partial[n] ?? "";
						});
						onChunk(out.join("\n"));
					}
				);
			} catch (e) {
				// The service resolves the route again and may land on another
				// candidate — a seq2seq one refuses a batched request outright.
				// A refusal before anything was yielded is the same case as
				// numbering that does not parse: go line by line. A failure
				// mid-stream, an abort and the timeout are real.
				if (streamed || timedOut || signal.aborted) {
					throw e;
				}

				translated = null;
			}
		}

		if (!translated) {
			translated = [];

			for (const [line, index] of filled) {
				const text = await translateOne(
					deps,
					request,
					info,
					line,
					controller.signal,
					(partial) => {
						out[index] = partial;
						onChunk(out.join("\n"));
					}
				);

				translated.push(text);
				out[index] = text;
			}
		}

		filled.forEach(([, index], n) => {
			out[index] = translated![n];
		});

		return finish(out.join("\n"));
	} catch (e) {
		if (timedOut) {
			throw new Error(TIMED_OUT);
		}

		if (signal.aborted) {
			throw new Error(ABORTED);
		}

		throw e;
	} finally {
		deps.clearTimeout(timer);
		signal.removeEventListener("abort", abort);
	}
}
