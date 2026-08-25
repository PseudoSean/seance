/**
 * Chat history over `draft/chathistory` (https://ircv3.net/specs/extensions/chathistory).
 *
 * Two flows feed the UI:
 *
 * - **Older messages** (`more` on the bus, and `LATEST` on the first JOIN of
 *   a channel): `CHATHISTORY BEFORE|LATEST <target> <ref> <limit>` is sent,
 *   the reply arrives as a `chathistory` batch (`handlers/batch.ts`), every
 *   line in it is replayed through the normal handlers in collect mode
 *   (`IrcClient.collectReplay`: nothing is dispatched, no counters move, no
 *   user-list / topic side effects) and the result is handed to
 *   `socket-events/more.ts` as one `more` event, oldest first, with ids
 *   below everything the channel already shows (`IdAllocator.historyIds`).
 *   History never sets `highlight`, never notifies and never counts as
 *   unread.
 * - **Catch-up** (re-JOIN after a reconnect): `CHATHISTORY AFTER <newest>`;
 *   the lines are appended as ordinary `msg` events, again without
 *   highlight / unread side effects, paging until a short page.
 *
 * Requests are matched to replies by `labeled-response` label when that
 * cap is on, else by target. `FAIL CHATHISTORY`, a labeled `ACK` or a
 * {@link HISTORY_TIMEOUT_MS} timeout answer the pending `more` with no
 * messages so the UI never sticks in `historyLoading` (bus-contract §more).
 */

import {ChanType} from "../../../shared/types/chan";
import type {SharedMsg} from "../../../shared/types/msg";
import type {Channel, MsgRef} from "./channel";
import type {IrcClient, ReplayedMessage} from "./client";
import type {BatchHandler} from "./handlers/batch";
import {formatLine, IrcMessage} from "./message";
import type {Handler} from "./types";

/** How long to wait for the server before answering `more` with nothing. */
export const HISTORY_TIMEOUT_MS = 15_000;
/** Page size for `more` (the old server also paged by 100). */
export const MORE_PAGE_SIZE = 100;
/** Page size for the LATEST request on first JOIN. */
export const JOIN_PAGE_SIZE = 50;
/** Most AFTER pages fetched in one catch-up. */
const MAX_CATCHUP_PAGES = 5;

export type HistorySubcommand = "LATEST" | "BEFORE" | "AFTER";

export interface HistoryRequest {
	chan: Channel;
	target: string;
	subcommand: HistorySubcommand;
	/** `labeled-response` label the reply is expected to carry. */
	label?: string;
	/** prepend: answer `more`; append: deliver as live `msg` events. */
	mode: "prepend" | "append";
	/** Limit as sent; a reply of this many lines means more may exist. */
	limit: number;
	/** Further AFTER pages allowed (append mode). */
	pagesLeft: number;
	timer: ReturnType<typeof setTimeout>;
}

const pendingByClient = new WeakMap<IrcClient, HistoryRequest[]>();
let labelCounter = 0;

function pendingOf(client: IrcClient): HistoryRequest[] {
	let list = pendingByClient.get(client);

	if (!list) {
		list = [];
		pendingByClient.set(client, list);
	}

	return list;
}

/** Requests in flight for `client` (tests / diagnostics). */
export function pendingHistory(client: IrcClient): readonly HistoryRequest[] {
	return pendingOf(client);
}

export function historyEnabled(client: IrcClient): boolean {
	return client.caps.hasCapability("draft/chathistory");
}

/** `wanted` capped by ISUPPORT `CHATHISTORY=<n>` (0 / absent = no cap). */
export function historyLimit(client: IrcClient, wanted: number): number {
	const cap = client.isupport.chathistory;
	return cap !== undefined && cap > 0 ? Math.min(wanted, cap) : wanted;
}

function canRequest(client: IrcClient, chan: Channel): boolean {
	return (
		historyEnabled(client) &&
		client.transport.state === "open" &&
		(chan.type === ChanType.CHANNEL || chan.type === ChanType.QUERY)
	);
}

/** `msgid=…` when we have one and the server takes it, else `timestamp=<ISO 8601>`. */
export function formatRef(client: IrcClient, ref: MsgRef): string {
	const types = client.isupport.tokens.get("MSGREFTYPES");
	const msgidOk = types === undefined || types.split(",").includes("msgid");

	if (ref.msgid && msgidOk) {
		return `msgid=${ref.msgid}`;
	}

	return `timestamp=${ref.time.toISOString()}`;
}

export interface HistorySpec {
	subcommand: HistorySubcommand;
	/** Reference message (required for BEFORE / AFTER). */
	ref?: MsgRef;
	limit: number;
	mode: "prepend" | "append";
	pagesLeft?: number;
}

/**
 * Send one CHATHISTORY request for `chan`. Returns the pending request, or
 * undefined when history is unavailable (cap off, disconnected, lobby).
 */
export function requestHistory(
	client: IrcClient,
	chan: Channel,
	spec: HistorySpec
): HistoryRequest | undefined {
	if (!canRequest(client, chan)) {
		return undefined;
	}

	const limit = historyLimit(client, spec.limit);
	const ref = spec.ref ? formatRef(client, spec.ref) : "*";
	const tags: Record<string, string> = {};
	let label: string | undefined;

	if (client.caps.hasCapability("labeled-response")) {
		label = `h${++labelCounter}`;
		tags.label = label;
	}

	const line = formatLine({
		tags,
		command: "CHATHISTORY",
		params: [spec.subcommand, chan.name, ref, String(limit)],
	});

	if (!client.send(line)) {
		return undefined;
	}

	const request: HistoryRequest = {
		chan,
		target: chan.name,
		subcommand: spec.subcommand,
		label,
		mode: spec.mode,
		limit,
		pagesLeft: spec.pagesLeft ?? 0,
		timer: setTimeout(() => resolve(client, request, null, "timeout"), HISTORY_TIMEOUT_MS),
	};
	pendingOf(client).push(request);
	chan.historyRequested = true;
	return request;
}

/**
 * The bus `more` emit: BEFORE the message the UI shows first (`lastId`), or
 * LATEST when the channel is empty (`lastId === -1`, which history ids
 * never use). False when nothing was sent — the caller must then answer
 * `more` itself.
 */
export function requestMore(client: IrcClient, chan: Channel, lastId: number): boolean {
	if (!canRequest(client, chan)) {
		return false;
	}

	if (lastId === -1) {
		return (
			requestHistory(client, chan, {
				subcommand: "LATEST",
				limit: MORE_PAGE_SIZE,
				mode: "prepend",
			}) !== undefined
		);
	}

	const ref = chan.msgRefs.get(lastId);

	if (!ref) {
		return false;
	}

	return (
		requestHistory(client, chan, {
			subcommand: "BEFORE",
			ref,
			limit: MORE_PAGE_SIZE,
			mode: "prepend",
		}) !== undefined
	);
}

/**
 * Our JOIN was confirmed: fill the channel. First time round that is the
 * latest {@link JOIN_PAGE_SIZE} messages; after a reconnect (history was
 * loaded before and we know the newest message) it is everything AFTER
 * that message, appended as live messages. `before` is the channel's newest
 * reference as it was before the JOIN line itself was pushed.
 */
export function requestChannelHistory(
	client: IrcClient,
	chan: Channel,
	before: MsgRef | undefined
): HistoryRequest | undefined {
	if (chan.historyRequested && before) {
		return requestHistory(client, chan, {
			subcommand: "AFTER",
			ref: before,
			limit: MORE_PAGE_SIZE,
			mode: "append",
			pagesLeft: MAX_CATCHUP_PAGES - 1,
		});
	}

	return requestHistory(client, chan, {
		subcommand: "LATEST",
		limit: JOIN_PAGE_SIZE,
		mode: "prepend",
	});
}

/** Transport closed: answer every pending request with nothing. */
export function abortHistory(client: IrcClient): void {
	for (const request of [...pendingOf(client)]) {
		resolve(client, request, null, "timeout");
	}
}

// ---------------------------------------------------------------- replies

function findRequest(
	client: IrcClient,
	label: string | undefined,
	targets: string[]
): HistoryRequest | undefined {
	const pending = pendingOf(client);

	if (label) {
		const byLabel = pending.find((r) => r.label === label);

		if (byLabel) {
			return byLabel;
		}
	}

	for (const target of targets) {
		const byTarget = pending.find((r) => client.namesEqual(r.target, target));

		if (byTarget) {
			return byTarget;
		}
	}

	return pending[0];
}

/**
 * Run the batch's lines through the normal handlers in collect mode and
 * keep what landed in `chan`, minus messages the channel already shows.
 */
function replay(client: IrcClient, chan: Channel, lines: IrcMessage[]): SharedMsg[] {
	const known = new Set(chan.msgids);
	const collected: ReplayedMessage[] = [];

	for (const line of lines) {
		const msgid = line.tags.get("msgid");

		for (const item of client.collectReplay(chan, () => client.handleMessage(line))) {
			// Event-playback handlers (TOPIC, QUIT, MODE…) do not copy the tag
			// themselves; every replayed message gets its line's msgid so it can
			// be deduplicated and used as a BEFORE/AFTER reference.
			if (msgid && !item.msg.msgid) {
				item.msg.msgid = msgid;
			}

			collected.push(item);
		}
	}

	const messages: SharedMsg[] = [];

	for (const {chan: target, msg} of collected) {
		if (target !== chan) {
			continue;
		}

		if (msg.msgid && known.has(msg.msgid)) {
			continue; // already shown (dedupe against the channel, not within the batch)
		}

		msg.highlight = false;
		messages.push(msg);
	}

	return messages;
}

/** Hand older messages to the UI as one `more` event. */
function deliverPrepend(
	client: IrcClient,
	chan: Channel,
	messages: SharedMsg[],
	moreAvailable: boolean
): void {
	const ids = client.historyIds(messages.length);
	let lastRef: MsgRef | undefined;

	messages.forEach((msg, i) => {
		msg.id = ids[i];
		lastRef = chan.remember(msg);
	});

	if (!chan.newestRef && lastRef) {
		chan.newestRef = lastRef;
	}

	chan.shared.totalMessages += messages.length;
	// socket-events/more.ts: moreHistoryAvailable = totalMessages > shown + new.
	const totalMessages = chan.shared.totalMessages + (moreAvailable ? 1 : 0);
	client.dispatch("more", {chan: chan.id, messages, totalMessages});
}

/** Append catch-up messages as live ones, without highlight / unread effects. */
function deliverAppend(client: IrcClient, chan: Channel, messages: SharedMsg[]): void {
	for (const msg of messages) {
		client.pushMessage(chan, msg);
	}
}

type Outcome = "batch" | "fail" | "ack" | "timeout";

function resolve(
	client: IrcClient,
	request: HistoryRequest,
	lines: IrcMessage[] | null,
	outcome: Outcome
): void {
	const pending = pendingOf(client);
	const idx = pending.indexOf(request);

	if (idx === -1) {
		return; // already answered (late reply after a timeout)
	}

	pending.splice(idx, 1);
	clearTimeout(request.timer);

	const {chan} = request;
	const messages = lines && lines.length > 0 ? replay(client, chan, lines) : [];
	const fullPage = lines !== null && lines.length >= request.limit;

	if (request.mode === "append") {
		deliverAppend(client, chan, messages);

		if (fullPage && request.pagesLeft > 0 && chan.newestRef) {
			requestHistory(client, chan, {
				subcommand: "AFTER",
				ref: chan.newestRef,
				limit: request.limit,
				mode: "append",
				pagesLeft: request.pagesLeft - 1,
			});
		}

		return;
	}

	// A timeout may be transient: leave the "show older messages" button
	// so the user can retry. FAIL / ACK / a short page mean there is no more.
	deliverPrepend(client, chan, messages, fullPage || outcome === "timeout");
}

/** Closed `chathistory` batch: answer the request it belongs to. */
export const chathistoryBatch: BatchHandler = (client, batch) => {
	const label = batch.tags.get("label") ?? batch.parent?.tags.get("label");
	const target = batch.params[0] ?? "";
	const request = findRequest(client, label, target ? [target] : []);

	if (request) {
		resolve(client, request, batch.messages, "batch");
		return;
	}

	// Unsolicited replay (server-initiated): show it as older history.
	const chan = target ? client.findChannel(target) : undefined;

	if (chan && (chan.type === ChanType.CHANNEL || chan.type === ChanType.QUERY)) {
		deliverPrepend(client, chan, replay(client, chan, batch.messages), false);
	}
};

/** `FAIL CHATHISTORY <code> [subcommand|target…] :text` (called by standard-replies.ts). */
export function chatHistoryFailed(client: IrcClient, msg: IrcMessage): void {
	const request = findRequest(client, msg.tags.get("label"), msg.params.slice(2, -1));

	if (request) {
		resolve(client, request, null, "fail");
	}
}

/** `labeled-response`: `@label=x ACK` means the request produced nothing. */
const ack: Handler = (client, msg) => {
	const label = msg.tags.get("label");
	const request = label ? pendingOf(client).find((r) => r.label === label) : undefined;

	if (request) {
		resolve(client, request, [], "ack");
	}
};

export default {ACK: ack};
