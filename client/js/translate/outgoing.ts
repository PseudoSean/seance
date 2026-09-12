// The composer's translation (spec § Composer), Vue-free and store-free:
// the gate, one draft translated as a unit — a multi-line draft as
// numbered lines so its line count survives — the languages of the round
// trip, and the rule for what a sent pair leaves in term memory. writer.ts
// is the store glue around it; ChatInput.vue renders the strip.

import type {PromptContext, TranslateChunk, TranslateRequest} from "./engine";
import {parseBatchedOutput, stripSentinel} from "./prompt";
import {appendMissing, protect, restore} from "./spans";

/** A draft's translation is given up after this long (the queue's limit). */
export const WRITE_TIMEOUT_MS = 2 * 60 * 1000;
/** A draft this short (words) whose translation is also short is a term worth remembering. */
export const TERM_MAX_WORDS = 3;
export const TERM_MAX_CHARS = 40;
export const TIMED_OUT = "timed out";
export const ABORTED = "aborted";

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
 * The source language sent with a write. The detector's verdict when it
 * has one; a draft too short to place is taken as the user's reading
 * language when that differs from the target, else left to the LLM.
 */
export function writeSource(
	detected: string | null,
	readingLanguage: string,
	writeTarget: string
): string | null {
	if (detected) {
		return detected;
	}

	return readingLanguage !== writeTarget ? readingLanguage : null;
}

/** The language a translation is read back into, or null when there is none to read back into. */
export function reverseTarget(
	detected: string | null,
	readingLanguage: string,
	writeTarget: string
): string | null {
	const candidate = detected ?? readingLanguage;

	return candidate !== writeTarget ? candidate : null;
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
}

/** One translation of `protectedText` streamed through `onChunk` (restored), resolved restored. */
async function translateOne(
	deps: OutgoingDeps,
	request: OutgoingRequest,
	line: string,
	signal: AbortSignal,
	onChunk: (text: string) => void
): Promise<string> {
	const guarded = protect(line);
	let last = "";

	for await (const chunk of deps.translate(
		{
			text: guarded.text,
			from: request.from,
			to: request.to,
			purpose: request.purpose,
			context: request.context,
		},
		signal
	)) {
		last = chunk.text;
		onChunk(restore(chunk.text, guarded.spans).text);
	}

	const restored = restore(last, guarded.spans);

	return appendMissing(restored.text, guarded.spans, restored.missing);
}

/** The numbered stream as it stands, numbers stripped and spans restored, for the strip. */
function batchedPreview(raw: string, spans: string[][]): string {
	return stripSentinel(raw)
		.split("\n")
		.map((line, i) => {
			const match = /^\s*\d+\.\s?(.*)$/.exec(line);
			const body = match ? match[1] : line;

			return spans[i] ? restore(body, spans[i]).text : body;
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
	lines: string[],
	signal: AbortSignal,
	onChunk: (text: string) => void
): Promise<string[] | null> {
	const guarded = lines.map((line) => protect(line));
	let last = "";

	for await (const chunk of deps.translate(
		{
			text: "",
			lines: guarded.map((g) => g.text),
			from: request.from,
			to: request.to,
			purpose: request.purpose,
			context: request.context,
		},
		signal
	)) {
		last = chunk.text;
		onChunk(
			batchedPreview(
				chunk.text,
				guarded.map((g) => g.spans)
			)
		);
	}

	const parsed = parseBatchedOutput(last, lines.length);

	if (!parsed) {
		return null;
	}

	return parsed.map((text, i) => {
		const restored = restore(text, guarded[i].spans);

		return appendMissing(restored.text, guarded[i].spans, restored.missing);
	});
}

/**
 * Translate a draft as a unit. Resolves the translation with the draft's
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
		const lines = request.text.split("\n");
		const filled = lines.map((l, i) => [l, i] as [string, number]).filter(([l]) => l.trim());

		if (filled.length <= 1) {
			const only = filled.length === 1 ? filled[0][0] : request.text;
			const text = await translateOne(deps, request, only, controller.signal, onChunk);

			return finish(text);
		}

		const out = [...lines];
		let translated: string[] | null = null;

		if (request.batches) {
			translated = await translateBatched(
				deps,
				request,
				filled.map(([l]) => l),
				controller.signal,
				(preview) => {
					const partial = preview.split("\n");

					filled.forEach(([, index], n) => {
						out[index] = partial[n] ?? "";
					});
					onChunk(out.join("\n"));
				}
			);
		}

		if (!translated) {
			translated = [];

			for (const [line, index] of filled) {
				const text = await translateOne(
					deps,
					request,
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
