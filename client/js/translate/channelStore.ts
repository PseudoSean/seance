// Per-channel translation state (spec § Settings, persistence): the reading
// and writing targets, formality and variant, the moment reading was
// switched on (older messages are not translated), and the channel's term
// memory. One JSON blob under `thelounge.translate`, keyed by network uuid
// and lower-cased channel name like helpers/mediaTrust.ts. Vue-free; the
// store slice in store.ts mirrors it for reactivity (reader.ts keeps the
// two in step).

import storage from "../localStorage";
import {isSupported} from "./languages";

export const STORAGE_KEY = "thelounge.translate";
export const TERM_CAP = 300;

export type Formality = "auto" | "formal" | "casual";

export interface ChannelTranslation {
	/** Reading target (ISO 639-1) or null when off. */
	read: string | null;
	/** Outgoing target (plan 3) or null. */
	write: string | null;
	formality: Formality;
	/** Free text for the prompt, e.g. "Brazilian Portuguese". */
	variant: string;
	/** When reading was switched on (ms); 0 when off. */
	since: number;
	/** Term memory, oldest first, one entry per source term. */
	terms: [string, string][];
}

export interface StorageBackend {
	get(key: string): string | null;
	set(key: string, value: string): void;
	remove(key: string): void;
}

let backend: StorageBackend = storage;

/** Swap the persistence backend (tests); `null` restores localStorage. */
export function useStorageBackend(next: StorageBackend | null): void {
	backend = next ?? storage;
}

export function channelKey(networkUuid: string, channelName: string): string {
	return `${networkUuid}/${channelName.toLowerCase()}`;
}

export function splitKey(key: string): {network: string; name: string} {
	const slash = key.indexOf("/");

	return {network: key.slice(0, slash), name: key.slice(slash + 1)};
}

export function defaultChannelTranslation(): ChannelTranslation {
	return {read: null, write: null, formality: "auto", variant: "", since: 0, terms: []};
}

function isFormality(value: unknown): value is Formality {
	return value === "auto" || value === "formal" || value === "casual";
}

function sanitize(value: unknown): ChannelTranslation | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}

	const raw = value as Record<string, unknown>;
	// Only the fields above survive: a record written by a later version
	// loses its extra keys the next time this one writes the blob.
	const out = defaultChannelTranslation();

	// A language this build cannot route (hand-edited, or dropped from
	// SUPPORTED_LANGUAGES by a later version) is no target at all: it would
	// leave the channel switched on with every line failing to route.
	out.read = typeof raw.read === "string" && isSupported(raw.read) ? raw.read : null;
	out.write = typeof raw.write === "string" && isSupported(raw.write) ? raw.write : null;
	out.formality = isFormality(raw.formality) ? raw.formality : "auto";
	out.variant = typeof raw.variant === "string" ? raw.variant : "";
	out.since = typeof raw.since === "number" && out.read ? raw.since : 0;
	out.terms = Array.isArray(raw.terms)
		? raw.terms
				.filter(
					(t): t is [string, string] =>
						Array.isArray(t) &&
						t.length === 2 &&
						typeof t[0] === "string" &&
						typeof t[1] === "string"
				)
				.slice(-TERM_CAP)
		: [];

	return out;
}

export function loadAll(): Record<string, ChannelTranslation> {
	let parsed: unknown;

	try {
		const raw = backend.get(STORAGE_KEY);

		parsed = raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return {};
	}

	const out: Record<string, ChannelTranslation> = {};

	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		const entry = sanitize(value);

		if (entry) {
			out[key] = entry;
		}
	}

	return out;
}

function saveAll(all: Record<string, ChannelTranslation>): void {
	backend.set(STORAGE_KEY, JSON.stringify(all));
}

export function getChannelTranslation(
	networkUuid: string,
	channelName: string
): ChannelTranslation {
	return loadAll()[channelKey(networkUuid, channelName)] ?? defaultChannelTranslation();
}

export function setChannelTranslation(
	networkUuid: string,
	channelName: string,
	patch: Partial<Omit<ChannelTranslation, "since" | "terms">>
): ChannelTranslation {
	const all = loadAll();
	const key = channelKey(networkUuid, channelName);
	const current = all[key] ?? defaultChannelTranslation();
	const rest = {...(patch as Partial<ChannelTranslation>)};

	delete rest.since;
	delete rest.terms;
	const next: ChannelTranslation = {...current, ...rest};

	if (next.read && !current.read) {
		next.since = Date.now();
	} else if (!next.read) {
		next.since = 0;
	}

	all[key] = next;
	saveAll(all);

	return next;
}

export function rememberTerm(
	networkUuid: string,
	channelName: string,
	pair: [string, string]
): void {
	const all = loadAll();
	const key = channelKey(networkUuid, channelName);
	const current = all[key] ?? defaultChannelTranslation();
	const terms = current.terms.filter(([source]) => source !== pair[0]);

	terms.push(pair);
	all[key] = {...current, terms: terms.slice(-TERM_CAP)};
	saveAll(all);
}

export function forgetChannel(networkUuid: string, channelName: string): void {
	const all = loadAll();

	delete all[channelKey(networkUuid, channelName)];
	saveAll(all);
}

export function forgetNetwork(networkUuid: string): void {
	const all = loadAll();

	for (const key of Object.keys(all)) {
		if (splitKey(key).network === networkUuid) {
			delete all[key];
		}
	}

	saveAll(all);
}
