// The posted line's translation (docs/resources/translation.md § Writing in
// a channel): when the composer sends a translation whose round trip
// finished, the read-back is what a reader of the channel would have been
// given for that line, so it becomes the line's translation instead of a
// request nobody needs. The composer records the read-back against the
// exact text it sends, *before* the send (the IRC layer dispatches the
// line's `msg` synchronously inside the emit), and the line is matched by
// channel and text as it reaches the store. Vue-free and store-free, so
// mocha reaches it; writer.ts is the glue.
//
// With `echo-message` one send reaches the store twice: first a pending
// copy, then the server's echo, which replaces it (`msg:settled`). The copy
// takes the read-back and the record stays for the echo, which takes it and
// ends the record. Without `echo-message` the one line takes it and ends the
// record. A line the server split (a long message chunked, a multi-line
// message on a server without `draft/multiline`) matches nothing and gets
// no translation.

import type {EngineName} from "./engine";

/** How long a record waits for its line: past the pending copy's own 60 s timeout. */
export const SENT_READ_BACK_TTL_MS = 90000;
/** Records kept across every channel; the oldest go first. */
export const SENT_READ_BACK_KEEP = 20;

export interface SentReadBackValue {
	/** The read-back, in the reading language. */
	text: string;
	/** The language the translation was sent in (the read-back's source). */
	from: string;
	/** The reading language the read-back is in. */
	to: string;
	/** The engine that produced the read-back. */
	engine: EngineName | null;
}

interface SentRecord {
	chanId: number;
	text: string;
	value: SentReadBackValue;
	at: number;
	/** The store id of the pending copy that already took it, if one did. */
	copyId?: number;
}

export interface SentReadBackMatch {
	value: SentReadBackValue;
	/** On the echo: the pending copy that held the read-back before it. */
	replacesCopy?: number;
}

export class SentReadBacks {
	private records: SentRecord[] = [];
	private readonly ttl: number;
	private readonly keep: number;

	constructor(ttl = SENT_READ_BACK_TTL_MS, keep = SENT_READ_BACK_KEEP) {
		this.ttl = ttl;
		this.keep = keep;
	}

	/** A translation is about to be sent into `chanId` as `text`. */
	record(chanId: number, text: string, value: SentReadBackValue, now: number): void {
		this.expire(now);
		this.records.push({chanId, text, value, at: now});

		if (this.records.length > this.keep) {
			this.records.splice(0, this.records.length - this.keep);
		}
	}

	/**
	 * An own line reached the store. A pending copy takes the oldest record
	 * no copy has taken yet and leaves it for its echo; a settled line (the
	 * echo, or the only line without `echo-message`) takes the oldest record
	 * for its text and ends it — echoes come back in the order the lines went
	 * out, so the oldest is the one whose copy was shown first.
	 */
	match(
		chanId: number,
		text: string,
		message: {id: number; pending?: boolean},
		now: number
	): SentReadBackMatch | undefined {
		this.expire(now);

		const same = (r: SentRecord) => r.chanId === chanId && r.text === text;

		if (message.pending) {
			const record = this.records.find((r) => same(r) && r.copyId === undefined);

			if (!record) {
				return undefined;
			}

			record.copyId = message.id;

			return {value: record.value};
		}

		const index = this.records.findIndex(same);

		if (index === -1) {
			return undefined;
		}

		const [record] = this.records.splice(index, 1);

		return record.copyId === undefined
			? {value: record.value}
			: {value: record.value, replacesCopy: record.copyId};
	}

	/** A channel went (a part, a quit): its records with it. */
	forget(chanId: number): void {
		this.records = this.records.filter((r) => r.chanId !== chanId);
	}

	get size(): number {
		return this.records.length;
	}

	private expire(now: number): void {
		this.records = this.records.filter((r) => now - r.at < this.ttl);
	}
}
