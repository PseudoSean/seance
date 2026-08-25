// In-memory message search over whatever is currently loaded in the Vuex
// store. There is no server and no history fetch behind this: it only sees
// messages that have already arrived in this browser session (or that were
// pulled in by scrolling up). A later phase can feed additional results from
// IRCv3 CHATHISTORY; keep the `SearchResult` shape so those can be merged in.

import {MessageType} from "../../shared/types/msg";
import type {ClientChan, ClientMessage, ClientNetwork} from "./types";

export type SearchQuery = {
	networkUuid: string;
	/** Restrict to one channel (by `chan.id`); omit to search the whole network. */
	channelId?: number;
	query: string;
	/** Page size. Defaults to `DEFAULT_SEARCH_LIMIT`. */
	limit?: number;
	/** Number of matches (newest first) to skip. Defaults to 0. */
	offset?: number;
};

export type SearchResult = ClientMessage & {
	chanId: number;
	networkUuid: string;
};

export type SearchResponse = {
	/** Matches for the requested page, newest first. */
	results: SearchResult[];
	/** Total number of matches across all pages. */
	total: number;
};

/** The minimum the store must provide; `store.state` satisfies it. */
export type SearchableState = {
	networks: ClientNetwork[];
};

export const DEFAULT_SEARCH_LIMIT = 100;

/** Message types whose `text` is user chat rather than protocol noise. */
export const SEARCHABLE_MESSAGE_TYPES: ReadonlySet<MessageType> = new Set<MessageType>([
	MessageType.MESSAGE,
	MessageType.ACTION,
	MessageType.NOTICE,
]);

export function normalizeQuery(query: string): string {
	return query.trim().toLowerCase();
}

/**
 * Whether a single message matches an already-normalized (trimmed, lowercased)
 * needle. Exported so a CHATHISTORY-backed provider can apply the same filter
 * to messages it fetches.
 */
export function messageMatches(msg: ClientMessage, needle: string): boolean {
	if (!needle) {
		return false;
	}

	const type = msg.type ?? MessageType.MESSAGE;

	if (!SEARCHABLE_MESSAGE_TYPES.has(type)) {
		return false;
	}

	if (typeof msg.text === "string" && msg.text.toLowerCase().includes(needle)) {
		return true;
	}

	const nick = msg.from?.nick;

	return typeof nick === "string" && nick.toLowerCase().includes(needle);
}

/** Newest first: by time descending, then id descending as a tiebreaker. */
export function compareNewestFirst(a: SearchResult, b: SearchResult): number {
	const timeDiff = toTime(b.time) - toTime(a.time);

	if (timeDiff !== 0) {
		return timeDiff;
	}

	return b.id - a.id;
}

function toTime(value: Date | string | number | undefined): number {
	if (value instanceof Date) {
		return value.getTime();
	}

	if (value === undefined) {
		return 0;
	}

	const parsed = new Date(value).getTime();

	return Number.isNaN(parsed) ? 0 : parsed;
}

function toResult(msg: ClientMessage, chan: ClientChan, network: ClientNetwork): SearchResult {
	return {...msg, chanId: chan.id, networkUuid: network.uuid};
}

/**
 * Search the messages currently loaded in the store.
 *
 * Case-insensitive substring match on `text` and `from.nick`, restricted to
 * chat message types (message/action/notice). Results are newest first and
 * paged with `limit`/`offset`; `total` is the number of matches across all
 * pages so callers can decide whether to offer "load more".
 *
 * Throws if the query is empty after trimming.
 */
export function searchMessages(state: SearchableState, query: SearchQuery): SearchResponse {
	const needle = normalizeQuery(query.query);

	if (needle.length < 1) {
		throw new Error("Search query must not be empty");
	}

	const limit = clampInt(query.limit, DEFAULT_SEARCH_LIMIT, 1);
	const offset = clampInt(query.offset, 0, 0);

	const network = state.networks.find((n) => n.uuid === query.networkUuid);

	if (!network) {
		return {results: [], total: 0};
	}

	const channels =
		query.channelId === undefined
			? network.channels
			: network.channels.filter((c) => c.id === query.channelId);

	const matches: SearchResult[] = [];

	for (const chan of channels) {
		for (const msg of chan.messages) {
			if (messageMatches(msg, needle)) {
				matches.push(toResult(msg, chan, network));
			}
		}
	}

	matches.sort(compareNewestFirst);

	return {
		results: matches.slice(offset, offset + limit),
		total: matches.length,
	};
}

function clampInt(value: number | undefined, fallback: number, min: number): number {
	if (value === undefined || !Number.isFinite(value)) {
		return fallback;
	}

	return Math.max(min, Math.floor(value));
}
