// The router (spec § router.ts): a table keyed by target language, then
// source, each entry an ordered list of candidates. `resolveRoute` returns
// the first candidate the device tier allows (an `llm` candidate is
// skipped, never failed, below the gpu tier), the user's engine settings
// allow, the catalog has a model for, and that is not marked down for the
// session. A seq2seq candidate needs a known source language; the LLM
// detects it itself.

import {Tier} from "./capability";
import {ModelRef} from "./engine";
import {Candidate, ModelCatalog, refFor} from "./models";

/** to → (from | "*") → candidates, with "*" → "*" as the last resort. */
export type RouteTable = Record<string, Record<string, Candidate[]>>;

export interface RouteInput {
	from: string | null;
	to: string;
	tier: Tier;
	allowLlm: boolean;
	allowCpu: boolean;
	down: ReadonlySet<Candidate>;
	/**
	 * Is this model already downloaded? Optional: without it every candidate
	 * counts as unknown and the order is the table's own.
	 */
	cached?: (ref: ModelRef) => boolean;
}

export interface Route {
	candidate: Candidate;
	ref: ModelRef;
}

export function candidatesFor(table: RouteTable, from: string | null, to: string): Candidate[] {
	const forTarget = table[to];

	if (forTarget) {
		if (from && forTarget[from]) {
			return forTarget[from];
		}

		if (forTarget["*"]) {
			return forTarget["*"];
		}
	}

	return table["*"]?.["*"] ?? [];
}

export function resolveRoute(
	table: RouteTable,
	catalog: ModelCatalog,
	input: RouteInput
): Route | null {
	if (input.tier === "none") {
		return null;
	}

	// A model that is already downloaded wins over one that is not, whatever
	// the table's order: the alternative is a request sitting inside its
	// two-minute deadline waiting for a download while a model that could
	// have answered it at once is on the device. Preference only — with
	// nothing cached (or no way to ask) the first allowed candidate stands.
	let first: Route | null = null;

	for (const candidate of candidatesFor(table, input.from, input.to)) {
		if (input.down.has(candidate)) {
			continue;
		}

		if (candidate === "llm") {
			if (input.tier !== "gpu" || !input.allowLlm) {
				continue;
			}
		} else if (!input.allowCpu || input.from === null) {
			continue;
		}

		const ref = refFor(catalog, candidate);

		if (!ref) {
			continue;
		}

		if (input.cached?.(ref)) {
			return {candidate, ref};
		}

		first = first ?? {candidate, ref};
	}

	return first;
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
