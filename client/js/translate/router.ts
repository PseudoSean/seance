// The router (spec § router.ts): a table keyed by target language, then
// source, each entry the candidates in **quality classes**, best class
// first. `resolveRoute` walks the classes in order and takes the first
// class with a candidate the device tier allows (an `llm` candidate is
// skipped, never failed, below the gpu tier), the user's engine settings
// allow, the catalog has a model for, and that is not marked down for the
// session. Inside that class a candidate whose model is already downloaded
// wins over the class's own order; a better class is never skipped for a
// downloaded model in a worse one: its model is downloaded on demand
// instead (service.ts). A seq2seq candidate needs a source language: the
// request's `from`, or failing that its source hint.

import {Tier} from "./capability";
import {ModelRef} from "./engine";
import {Candidate, ModelCatalog, refFor} from "./models";

/**
 * One table entry: its elements are quality classes, best first. A bare
 * candidate is a class of one, so a flat list (`["llm", "nllb"]`, the
 * shape every deploy override had) is a strict order, and a nested list
 * (`[["llm", "opus:de-en"], "nllb"]`) makes its candidates equivalent: the
 * downloaded one is preferred, the list's order breaks the tie.
 */
export type RouteEntry = (Candidate | Candidate[])[];

/** to → (from | "*") → classes; "*" → from and "*" → "*" behind a target's own rows. */
export type RouteTable = Record<string, Record<string, RouteEntry>>;

export interface RouteInput {
	from: string | null;
	/**
	 * The language the caller's detector placed the text in when the verdict
	 * was too weak to name as `from`: the reading queue's
	 * `QueueItem.routeHint` and the composer's `sourceHintFor`, which travel
	 * as `TranslateRequest.hint` -- routing only, never the prompt's
	 * `PromptContext.sourceHint`. It picks the table row when `from` is
	 * null, and lets a seq2seq candidate run with it as its source; the LLM
	 * request keeps `from: null`.
	 */
	hint: string | null;
	to: string;
	tier: Tier;
	allowLlm: boolean;
	allowCpu: boolean;
	down: ReadonlySet<Candidate>;
	/**
	 * Is this model already downloaded? Optional: without it every candidate
	 * counts as unknown and each class's order is the table's own.
	 */
	cached?: (ref: ModelRef) => boolean;
}

export interface Route {
	candidate: Candidate;
	ref: ModelRef;
}

/** An entry's classes, each a non-empty list of candidates. */
export function classesOf(entry: RouteEntry): Candidate[][] {
	return entry
		.map((element) => (Array.isArray(element) ? [...element] : [element]))
		.filter((group) => group.length > 0);
}

/**
 * The classes for a pair: the target's row for the source, the target's
 * wildcard, the wildcard target's row for the source, then the global
 * wildcard.
 */
export function candidatesFor(table: RouteTable, from: string | null, to: string): Candidate[][] {
	const forTarget = table[to];
	const anyTarget = table["*"];
	const entry =
		(from ? forTarget?.[from] : undefined) ??
		forTarget?.["*"] ??
		(from ? anyTarget?.[from] : undefined) ??
		anyTarget?.["*"] ??
		[];

	return classesOf(entry);
}

export function resolveRoute(
	table: RouteTable,
	catalog: ModelCatalog,
	input: RouteInput
): Route | null {
	if (input.tier === "none") {
		return null;
	}

	const source = input.from ?? input.hint;

	// A request in one language (purpose "polish": the composer's cleanup
	// pass) is prose work only a language model can do: the LLM where it
	// may run, else no route -- a seq2seq model asked to translate English
	// into English would mangle the line.
	if (source !== null && source === input.to) {
		if (input.tier !== "gpu" || !input.allowLlm || input.down.has("llm")) {
			return null;
		}

		const ref = refFor(catalog, "llm");

		return ref ? {candidate: "llm", ref} : null;
	}

	for (const group of candidatesFor(table, source, input.to)) {
		let first: Route | null = null;

		for (const candidate of group) {
			if (input.down.has(candidate)) {
				continue;
			}

			if (candidate === "llm") {
				if (input.tier !== "gpu" || !input.allowLlm) {
					continue;
				}
			} else if (!input.allowCpu || source === null) {
				continue;
			}

			const ref = refFor(catalog, candidate);

			if (!ref) {
				continue;
			}

			// Preference inside the class only: an equivalent model already on
			// the device answers at once instead of waiting for a download.
			if (input.cached?.(ref)) {
				return {candidate, ref};
			}

			first = first ?? {candidate, ref};
		}

		if (first) {
			return first;
		}
	}

	return null;
}

/** A deploy's `translation.routes` over the shipped table, one entry at a time. */
export function mergeRoutes(base: RouteTable, override: RouteTable): RouteTable {
	const merged: RouteTable = {};

	for (const [to, sources] of Object.entries(base)) {
		merged[to] = {...sources};
	}

	for (const [to, sources] of Object.entries(override)) {
		merged[to] = {...(merged[to] ?? {}), ...sources};
	}

	return merged;
}
