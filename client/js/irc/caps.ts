/**
 * IRCv3 capability negotiation (CAP LS 302 / REQ / ACK / NAK / NEW / DEL).
 *
 * {@link CapNegotiator} does no I/O: feed it parsed messages and send back
 * the lines it returns. The intended sequence is
 *
 *   1. send `start()`                      -> `CAP LS 302`
 *   2. send `NICK` and `USER` yourself     (the negotiator never does)
 *   3. for each incoming `CAP` message call `handle()` and send `.send`
 *      - after the final `CAP * LS` it emits one or more `CAP REQ :...`
 *      - once every requested cap is ACKed/NAKed it emits `CAP END`
 *        and reports `done: true`
 *   4. keep calling `handle()` after registration for `CAP NEW` / `CAP DEL`
 *      (`cap-notify`); it may emit further `CAP REQ`s.
 *
 * Phase D (SASL) will run between the ACK and `CAP END` via {@link
 * CapNegotiator.beforeEnd}; that hook is declared but not yet consulted.
 */

import {IrcMessage, MAX_LINE_BYTES, splitMessage} from "./message";

export interface CapNegotiatorOptions {
	/** Caps we cannot function without; missing/NAKed ones are reported. */
	required: string[];
	/** Caps to request if the server offers them. */
	wanted: string[];
}

export interface CapResult {
	/** Lines to send, in order. */
	send: string[];
	/** True once `CAP END` has been emitted. */
	done: boolean;
	/** Required caps the server did not offer, NAKed or removed. */
	missingRequired: string[];
	error?: string;
}

/**
 * Caps Seance requests when offered. Everything is "wanted" for v1 so that a
 * plain ircd (nefarious2 master, which has no CAP 302 and only seven caps)
 * still registers. Deliberately absent: `draft/multiline` (blocked by the
 * 528-byte inbound frame bug, see message.ts), `draft/bouncer`,
 * `draft/persistence`, `draft/metadata-2`, `no-implicit-names`.
 */
export const SEANCE_CAPS: CapNegotiatorOptions = {
	required: [],
	wanted: [
		"multi-prefix",
		"userhost-in-names",
		"extended-join",
		"away-notify",
		"account-notify",
		"cap-notify",
		"server-time",
		"echo-message",
		"account-tag",
		"chghost",
		"invite-notify",
		"labeled-response",
		"batch",
		"setname",
		"standard-replies",
		"message-tags",
		"draft/chathistory",
		"draft/event-playback",
	],
};

/**
 * Caps that are never put in a `CAP REQ`: `sasl` is driven separately by the
 * SASL flow, `tls` (STARTTLS) is meaningless over a WebSocket and `sts` is
 * informational only.
 */
const NEVER_REQUEST: ReadonlySet<string> = new Set(["sasl", "tls", "sts"]);

const REQ_PREFIX = "CAP REQ :";

/** Parse a CAP LS/NEW/ACK list (`name[=value] ...`) into [name, value] pairs. */
function parseCapList(list: string): [string, string][] {
	const result: [string, string][] = [];

	for (const token of list.split(/[ \t]+/)) {
		if (token.length === 0) {
			continue;
		}

		const eq = token.indexOf("=");

		if (eq === -1) {
			result.push([token, ""]);
		} else {
			result.push([token.slice(0, eq), token.slice(eq + 1)]);
		}
	}

	return result;
}

export class CapNegotiator {
	/** Caps the server advertised (LS / NEW minus DEL) with their 302 values ("" if none). */
	readonly available = new Map<string, string>();
	/** Caps currently enabled (ACKed, not DELed). */
	readonly enabled = new Set<string>();

	/**
	 * Reserved for phase D: called once all REQs are answered and before
	 * `CAP END` is emitted, returning lines to send first (e.g. the SASL
	 * exchange). Not consulted yet.
	 */
	beforeEnd?: () => string[] | Promise<string[]>;

	private readonly required: string[];
	private readonly wanted: string[];
	/** Caps in flight in a `CAP REQ` that have not been ACKed/NAKed. */
	private readonly outstanding = new Set<string>();
	private lsComplete = false;
	private ended = false;
	/** Set when a required cap is missing at LS time; negotiation halts. */
	private failed = false;

	constructor(options: CapNegotiatorOptions) {
		this.required = [...options.required];
		this.wanted = [...options.wanted];
	}

	/** True once `CAP END` has been emitted. */
	get done(): boolean {
		return this.ended;
	}

	/** Lines that open negotiation. */
	start(): string[] {
		return ["CAP LS 302"];
	}

	/** The 302 value the server advertised for `cap`, "" if none, undefined if not offered. */
	value(cap: string): string | undefined {
		return this.available.get(cap);
	}

	hasCapability(cap: string): boolean {
		return this.enabled.has(cap);
	}

	/** Process one incoming message. Non-CAP messages are ignored. */
	handle(msg: IrcMessage): CapResult {
		const result: CapResult = {send: [], done: this.ended, missingRequired: []};

		if (msg.command !== "CAP" || msg.params.length < 2) {
			return result;
		}

		const subcommand = msg.params[1].toUpperCase();
		let list = msg.params[2] ?? "";
		let more = false;

		if (list === "*" && msg.params.length > 3) {
			more = true;
			list = msg.params[3];
		}

		switch (subcommand) {
			case "LS":
				this.onLs(parseCapList(list), more, result);
				break;
			case "LIST":
				this.enabled.clear();

				for (const [name] of parseCapList(list)) {
					this.enabled.add(name);
				}

				break;
			case "ACK":
				this.onAck(parseCapList(list));
				break;
			case "NAK":
				this.onNak(parseCapList(list), result);
				break;
			case "NEW":
				this.onNew(parseCapList(list), result);
				break;
			case "DEL":
				this.onDel(parseCapList(list), result);
				break;
			default:
				break;
		}

		this.maybeEnd(result);
		result.done = this.ended;

		if (result.missingRequired.length > 0 && result.error === undefined) {
			result.error = `Missing required capabilities: ${result.missingRequired.join(" ")}`;
		}

		return result;
	}

	private onLs(caps: [string, string][], more: boolean, result: CapResult): void {
		for (const [name, value] of caps) {
			this.available.set(name, value);
		}

		if (more || this.lsComplete) {
			return;
		}

		this.lsComplete = true;

		for (const name of this.required) {
			if (!this.available.has(name)) {
				result.missingRequired.push(name);
			}
		}

		if (result.missingRequired.length > 0) {
			// Leave the caller to QUIT; do not proceed to REQ/END.
			this.failed = true;
			return;
		}

		this.request(this.desired(), result);
	}

	private onAck(caps: [string, string][]): void {
		for (const [token] of caps) {
			if (token.startsWith("-")) {
				const name = token.slice(1);
				this.enabled.delete(name);
				this.outstanding.delete(name);
			} else {
				this.enabled.add(token);
				this.outstanding.delete(token);
			}
		}
	}

	private onNak(caps: [string, string][], result: CapResult): void {
		for (const [name] of caps) {
			this.outstanding.delete(name);

			if (this.required.includes(name)) {
				result.missingRequired.push(name);
			}
		}
	}

	private onNew(caps: [string, string][], result: CapResult): void {
		for (const [name, value] of caps) {
			this.available.set(name, value);
		}

		if (!this.lsComplete) {
			// Still collecting LS; the REQ after the final LS will pick these up.
			return;
		}

		const newNames = new Set(caps.map(([name]) => name));

		this.request(
			this.desired().filter((name) => newNames.has(name)),
			result
		);
	}

	private onDel(caps: [string, string][], result: CapResult): void {
		for (const [name] of caps) {
			this.available.delete(name);
			this.enabled.delete(name);
			this.outstanding.delete(name);

			if (this.required.includes(name)) {
				result.missingRequired.push(name);
			}
		}
	}

	/** Required + wanted caps the server offers, deduplicated, minus the never-REQ set. */
	private desired(): string[] {
		const names: string[] = [];

		for (const name of [...this.required, ...this.wanted]) {
			if (
				this.available.has(name) &&
				!NEVER_REQUEST.has(name) &&
				!this.enabled.has(name) &&
				!this.outstanding.has(name) &&
				!names.includes(name)
			) {
				names.push(name);
			}
		}

		return names;
	}

	private request(names: string[], result: CapResult): void {
		if (names.length === 0) {
			return;
		}

		for (const name of names) {
			this.outstanding.add(name);
		}

		// One REQ normally; split only if the line would exceed the frame cap.
		for (const chunk of splitMessage(REQ_PREFIX.length, names.join(" "), MAX_LINE_BYTES)) {
			result.send.push(REQ_PREFIX + chunk);
		}
	}

	private maybeEnd(result: CapResult): void {
		if (this.ended || this.failed || !this.lsComplete || this.outstanding.size > 0) {
			return;
		}

		this.ended = true;
		result.send.push("CAP END");
	}
}
