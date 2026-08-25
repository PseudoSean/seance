/**
 * IrcClient — one IRC network, spoken directly to an IRCv3 server over a
 * WebSocket, feeding the Vue UI through the in-process event bus.
 *
 * It owns a {@link WsTransport}, a {@link CapNegotiator}, an {@link ISupport}
 * registry and the `SharedNetwork` model the UI is given (lobby, channels,
 * queries, users, topics). Inbound lines are parsed and dispatched to the
 * handlers in `./handlers/` (one file per command / numeric); typed input is
 * routed through the commands in `./commands/`. Both are registries so new
 * behaviour is added by dropping in a file, not by editing this class.
 *
 * Bus contract: docs/resources/bus-contract.md. Everything the UI needs to
 * react to is a `dispatch()`; the client never touches the store directly
 * (that keeps it usable under mocha, where there is no DOM).
 */

import socket, {EventBus} from "../socket";
import {isHighlight} from "../highlight";
import {ChanState, ChanType} from "../../../shared/types/chan";
import {MessageType, SharedMsg} from "../../../shared/types/msg";
import type {SharedNetwork, SharedServerOptions} from "../../../shared/types/network";
import {CapNegotiator, SEANCE_CAPS} from "./caps";
import {casefold, namesEqual} from "./casemap";
import {Channel, MsgRef} from "./channel";
import {commandNames, dispatchInput} from "./commands";
import {handlers, unhandled} from "./handlers";
import {interceptBatchLine, resetBatches} from "./handlers/batch";
import {abortHistory, requestChannelHistory} from "./history";
import {IdAllocator, sharedIds} from "./ids";
import {ISupport} from "./isupport";
import {formatLine, IrcMessage, parseLine, splitMessage, utf8ByteLength} from "./message";
import {mechanismOffered, SASL_TIMEOUT_MS, SaslAuth, SaslMechanism, SaslResult} from "./sasl";
import {ReconnectOptions, TransportEvent, TransportOptions, WsTransport} from "./transport";
import type {ConnectOptions, IrcClientState, Transport} from "./types";
import {trailingLine} from "./wire";

export interface HighlightKeywords {
	keywords: string[];
	exceptions: string[];
}

/** A message produced while replaying history (see {@link IrcClient.collectReplay}). */
export interface ReplayedMessage {
	chan: Channel;
	msg: SharedMsg;
}

export interface IrcClientOptions extends ConnectOptions {
	/** Stable network id; derived from host/port/nick when omitted. */
	uuid?: string;
	username?: string;
	realname?: string;
	leaveMessage?: string;
	/** Where to dispatch bus events; defaults to the app bus. */
	bus?: Pick<EventBus, "dispatch">;
	ids?: IdAllocator;
	/** Build the transport (tests inject a fake); defaults to `new WsTransport(opts)`. */
	transportFactory?: (opts: TransportOptions) => Transport;
	reconnect?: ReconnectOptions;
	/** Custom highlight keywords (from the settings store). */
	highlights?: () => HighlightKeywords;
	/** Persist a channel's muted flag (`/mute`, `/unmute`); see client/js/mute.ts. */
	setMuteStatus?: (chanId: number, muted: boolean) => void;
	/**
	 * Networks to send in `init`. The `init` listener replaces the store's
	 * network list wholesale, so with several networks the manager supplies
	 * all of them here. Defaults to just this network.
	 */
	networksForInit?: () => SharedNetwork[];
}

export const NOT_CONNECTED_TEXT =
	"You are not connected to the IRC network, unable to send your command.";

/** Prefix characters a channel name may start with when the user omits one. */
const CHANNEL_PREFIXES = "#&!+";

export class IrcClient {
	readonly uuid: string;
	readonly options: Readonly<IrcClientOptions>;
	readonly transport: Transport;
	readonly isupport = new ISupport();
	readonly channels: Channel[] = [];
	readonly lobby: Channel;
	caps = new CapNegotiator(SEANCE_CAPS);

	/** Our current nick as the server knows it (or the one we asked for). */
	nick: string;
	ident: string;
	/** Our visible host; empty until the server tells us (JOIN echo, 396, CHGHOST). */
	host = "";
	/** MOTD lines being collected between 375 and 376. */
	motdBuffer: string[] | null = null;
	/** The SASL exchange in progress during registration, if any. */
	sasl: SaslAuth | null = null;
	/** Services account we are logged in as (900/901); "" when not. */
	account = "";

	private saslTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly bus: Pick<EventBus, "dispatch">;
	private readonly ids: IdAllocator;
	private readonly url: string;
	private networkName: string;
	private _state: IrcClientState = "disconnected";
	private connected = false;
	private announced = false;
	private quitting = false;
	private activeChanId = 0;
	/** Set while a history batch is replayed through the handlers (see `collectReplay`). */
	private replayContext: {target: Channel; collected: ReplayedMessage[]} | null = null;

	constructor(options: IrcClientOptions) {
		const host = options.host.trim();
		this.options = {...options, host};
		this.nick = options.nick;
		this.ident = options.username || sanitizeIdent(options.nick);
		this.uuid = options.uuid ?? deriveUuid(host, options.port, options.nick);
		this.networkName = hostnameOf(host);
		this.bus = options.bus ?? socket;
		this.ids = options.ids ?? sharedIds;
		this.url = buildUrl(host, options.port, options.tls);

		const transportOptions: TransportOptions = {
			url: this.url,
			subprotocols: ["text.ircv3.net", "binary.ircv3.net"],
		};

		if (options.reconnect) {
			transportOptions.reconnect = options.reconnect;
		}

		this.transport = options.transportFactory
			? options.transportFactory(transportOptions)
			: new WsTransport(transportOptions);
		this.transport.on((ev) => this.onTransportEvent(ev));

		this.lobby = new Channel(this.ids.chanId(), this.networkName, ChanType.LOBBY, (s) =>
			this.casefold(s)
		);
		this.channels.push(this.lobby);

		for (const {name, key} of parseJoinList(options.join)) {
			const {channel} = this.createChannel(name, ChanType.CHANNEL, {key});
			channel.autoJoin = true;
		}
	}

	// ---------------------------------------------------------------- state

	get state(): IrcClientState {
		return this._state;
	}

	/** Registered with the server (001 and end of MOTD seen). */
	get isConnected(): boolean {
		return this.connected;
	}

	get name(): string {
		return this.networkName;
	}

	/** True between our own QUIT/disconnect and the transport closing. */
	get isQuitting(): boolean {
		return this.quitting;
	}

	get serverOptions(): SharedServerOptions {
		const {modes, symbols} = this.isupport.prefix;
		const prefix = modes.split("").map((mode, i) => ({mode, symbol: symbols[i]}));
		const modeToSymbol: Record<string, string> = {};

		for (const entry of prefix) {
			modeToSymbol[entry.mode] = entry.symbol;
		}

		return {
			CHANTYPES: this.isupport.chantypes.split(""),
			PREFIX: {prefix, modeToSymbol, symbols: symbols.split("")},
			NETWORK: this.isupport.network ?? this.networkName,
		};
	}

	/** The `SharedNetwork` snapshot the UI is given (channels carry no messages). */
	get network(): SharedNetwork {
		return {
			uuid: this.uuid,
			name: this.networkName,
			nick: this.nick,
			serverOptions: this.serverOptions,
			status: {connected: this.connected, secure: this.options.tls},
			channels: this.channels.map((chan) => chan.snapshot()),
		};
	}

	/** Fields `network:info` / the edit form expect, minus `channels`. */
	get editableInfo(): Record<string, unknown> {
		const o = this.options;

		return {
			uuid: this.uuid,
			name: this.networkName,
			nick: this.nick,
			host: o.host,
			port: o.port,
			tls: o.tls,
			rejectUnauthorized: true,
			username: this.ident,
			realname: o.realname || o.nick,
			password: "",
			leaveMessage: o.leaveMessage ?? "",
			sasl: o.sasl,
			saslAccount: o.saslAccount,
			saslPassword: o.saslPassword,
			commands: [],
			proxyEnabled: false,
			proxyHost: "",
			proxyPort: 0,
			proxyUsername: "",
			proxyPassword: "",
			hasSTSPolicy: false,
		};
	}

	// ------------------------------------------------------------ lifecycle

	/** Announce the network to the UI (first call only) and open the transport. */
	connect(): void {
		if (!this.announced) {
			this.announced = true;
			this.bus.dispatch("network", {network: this.network});
		}

		if (this.transport.state === "open" || this.transport.state === "connecting") {
			return;
		}

		this.quitting = false;
		this._state = "connecting";
		this.bus.dispatch("connecting");
		this.pushMessage(
			this.lobby,
			{text: `Connecting to ${this.options.host}:${this.options.port}…`},
			true
		);
		this.transport.connect();
	}

	/** Send QUIT and close without reconnecting; the network stays in the UI. */
	disconnect(reason?: string): void {
		this.quitting = true;

		if (this.transport.state === "open") {
			this.transport.send(trailingLine("QUIT", [reason ?? "Seance"]));
		}

		this.transport.close();
	}

	/** `/quit`: remove the network from the UI, then disconnect for good. */
	quit(reason?: string): void {
		this.bus.dispatch("quit", {network: this.uuid});
		this.disconnect(reason);
	}

	private onTransportEvent(ev: TransportEvent): void {
		switch (ev.type) {
			case "open":
				this.onOpen();
				break;
			case "line":
				this.handleLine(ev.line);
				break;
			case "close":
				this.onClose(ev.code, ev.reason, ev.willReconnect);
				break;
			case "reconnecting":
				this._state = "connecting";
				this.bus.dispatch("connecting");
				this.pushMessage(
					this.lobby,
					{
						text: `Reconnecting in ${Math.max(
							1,
							Math.round(ev.delayMs / 1000)
						)}s (attempt ${ev.attempt})…`,
					},
					true
				);
				break;
			case "error":
				// Always followed by a close event, which is where we report.
				break;
		}
	}

	/** Transport open: fresh negotiation state, then CAP LS / NICK / USER. */
	private onOpen(): void {
		this._state = "registering";
		this.connected = false;
		this.caps = this.createCaps();
		this.isupport.reset();
		this.motdBuffer = null;
		this.host = "";
		this.account = "";
		this.endSasl();

		for (const line of this.caps.start()) {
			this.send(line);
		}

		this.send(formatLine({command: "NICK", params: [this.nick]}));
		this.send(trailingLine("USER", [this.ident, "0", "*", this.options.realname || this.nick]));
	}

	// ------------------------------------------------------------------ SASL

	/** The mechanism the user configured, or null for none. */
	private get saslMechanism(): SaslMechanism | null {
		switch (this.options.sasl) {
			case "plain":
				return this.options.saslAccount && this.options.saslPassword ? "PLAIN" : null;
			case "external":
				return "EXTERNAL";
			default:
				return null;
		}
	}

	/** A negotiator that also asks for `sasl` (when usable) and runs SASL before `CAP END`. */
	private createCaps(): CapNegotiator {
		const mechanism = this.saslMechanism;

		if (!mechanism) {
			return new CapNegotiator(SEANCE_CAPS);
		}

		const caps = new CapNegotiator({
			...SEANCE_CAPS,
			wanted: [...SEANCE_CAPS.wanted, "sasl"],
			accept: (name, value) => name !== "sasl" || mechanismOffered(mechanism, value),
		});
		caps.beforeEnd = () => this.startSasl(mechanism);
		return caps;
	}

	/** `beforeEnd` hook: open the exchange if the server enabled `sasl`, else nothing. */
	private startSasl(mechanism: SaslMechanism): string[] {
		if (!this.caps.hasCapability("sasl")) {
			return [];
		}

		this.sasl = new SaslAuth(mechanism, {
			account: this.options.saslAccount,
			password: this.options.saslPassword,
		});
		this.armSaslTimer();
		return this.sasl.start();
	}

	/** Apply what the state machine returned for one inbound line (called by handlers/sasl.ts). */
	saslProgress(result: SaslResult): void {
		for (const line of result.send) {
			this.send(line);
		}

		if (result.info) {
			this.pushMessage(this.lobby, {text: result.info}, true);
		}

		if (!result.done) {
			this.armSaslTimer();
			return;
		}

		this.endSasl();

		if (!result.ok) {
			this.pushMessage(
				this.lobby,
				{
					type: MessageType.ERROR,
					text: `SASL authentication failed: ${result.error ?? "unknown error"}`,
				},
				true
			);

			if (this.options.saslDisconnectOnFail) {
				this.disconnect("SASL authentication failed");
				return;
			}
		}

		for (const line of this.caps.end()) {
			this.send(line);
		}
	}

	private armSaslTimer(): void {
		this.clearSaslTimer();
		this.saslTimer = setTimeout(() => {
			this.saslTimer = null;

			if (this.sasl && !this.sasl.done) {
				this.saslProgress(this.sasl.abort("timed out waiting for the server"));
			}
		}, SASL_TIMEOUT_MS);
	}

	private clearSaslTimer(): void {
		if (this.saslTimer !== null) {
			clearTimeout(this.saslTimer);
			this.saslTimer = null;
		}
	}

	private endSasl(): void {
		this.clearSaslTimer();
		this.sasl = null;
	}

	private onClose(code: number, reason: string, willReconnect: boolean): void {
		const wasUp = this._state !== "disconnected";
		this._state = "disconnected";
		this.connected = false;
		this.endSasl();

		resetBatches(this);
		abortHistory(this);

		for (const chan of this.channels) {
			chan.users.clear();
			chan.namesBuffer = null;

			if (chan.type === ChanType.CHANNEL) {
				chan.state = ChanState.PARTED;
			}
		}

		this.bus.dispatch("network:status", {
			network: this.uuid,
			connected: false,
			secure: this.options.tls,
		});

		if (wasUp) {
			const why = reason ? `: ${reason}` : code === 1000 ? "" : ` (code ${code})`;
			this.pushMessage(
				this.lobby,
				{
					type: this.quitting ? undefined : MessageType.ERROR,
					text: this.quitting
						? "Disconnected."
						: `Disconnected from ${this.options.host}${why}${
								willReconnect ? "" : ". Not reconnecting."
						  }`,
				},
				true
			);
		}
	}

	/** Called by the 376/422 handler once registration has completed. */
	onRegistered(): void {
		if (this.connected) {
			return;
		}

		this.connected = true;
		this._state = "registered";

		const first = this.channels.find((chan) => chan.type === ChanType.CHANNEL);
		const networks = this.options.networksForInit
			? this.options.networksForInit()
			: [this.network];
		this.bus.dispatch("init", {active: (first ?? this.lobby).id, networks});
		this.bus.dispatch("network:status", {
			network: this.uuid,
			connected: true,
			secure: this.options.tls,
		});
		this.bus.dispatch("commands", commandNames());

		if (this.caps.enabled.size > 0) {
			this.pushMessage(
				this.lobby,
				{text: `Enabled capabilities: ${Array.from(this.caps.enabled).join(", ")}`},
				true
			);
		}

		for (const chan of this.channels) {
			if (
				chan.type === ChanType.CHANNEL &&
				chan.autoJoin &&
				chan.state === ChanState.PARTED
			) {
				this.joinChannel(chan.name, chan.shared.key);
			}
		}
	}

	// --------------------------------------------------------------- sending

	/** Send one raw line. Reports an ERROR message in the lobby instead of throwing. */
	send(line: string): boolean {
		if (this.transport.state !== "open") {
			this.pushMessage(this.lobby, {type: MessageType.ERROR, text: NOT_CONNECTED_TEXT});
			return false;
		}

		try {
			this.transport.send(line);
			return true;
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			this.pushMessage(this.lobby, {type: MessageType.ERROR, text: `Not sent: ${message}`});
			return false;
		}
	}

	/**
	 * PRIVMSG/NOTICE `text` to `target`, split into lines that fit the frame
	 * cap. Without `echo-message` the lines are fed back through the inbound
	 * handlers as if the server had echoed them.
	 */
	sendMessage(target: string, text: string, opts: {notice?: boolean; action?: boolean} = {}) {
		const command = opts.notice ? "NOTICE" : "PRIVMSG";
		// The server prepends our full source to the echo; budget for it even
		// when the host is still unknown (63 is the usual hostname limit).
		const hostLen = this.host.length || 63;
		let prefixBytes = utf8ByteLength(`:${this.nick}!${this.ident}@`) + hostLen;
		prefixBytes += utf8ByteLength(` ${command} ${target} :`);

		if (opts.action) {
			prefixBytes += "\x01ACTION \x01".length;
		}

		let chunks: string[];

		try {
			chunks = splitMessage(prefixBytes, text.replace(/[\r\n\0]/g, " "));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			this.pushMessage(this.lobby, {type: MessageType.ERROR, text: `Not sent: ${message}`});
			return;
		}

		const echo = this.caps.hasCapability("echo-message");

		for (const chunk of chunks) {
			const body = opts.action ? `\x01ACTION ${chunk}\x01` : chunk;

			if (!this.send(trailingLine(command, [target, body]))) {
				return;
			}

			if (!echo) {
				this.handleLine(
					`:${this.nick}!${this.ident}@${
						this.host || "localhost"
					} ${command} ${target} :${body}`
				);
			}
		}
	}

	joinChannel(name: string, key = ""): void {
		this.send(formatLine({command: "JOIN", params: key ? [name, key] : [name]}));
	}

	/** Handle a line of user input typed into channel `chanId`. */
	input(chanId: number, text: string): void {
		const chan = this.channelById(chanId);

		if (chan) {
			dispatchInput(this, chan, text);
		}
	}

	/** The UI opened `chanId` (or 0 for none): unread counters restart there. */
	open(chanId: number): void {
		this.activeChanId = chanId;
		const chan = this.channelById(chanId);

		if (chan) {
			chan.shared.unread = 0;
			chan.shared.highlight = 0;
		}
	}

	// -------------------------------------------------------------- inbound

	/** Parse and handle one inbound line (also used for local echo). */
	handleLine(line: string): void {
		const msg = parseLine(line);

		if (!msg || msg.command === "PING" || msg.command === "PONG") {
			return; // the transport answers PING itself
		}

		this.handleMessage(msg);
	}

	/**
	 * Route one parsed message: batch buffering first, then the handler for
	 * its command. Also the entry point for replaying buffered batch lines.
	 */
	handleMessage(msg: IrcMessage): void {
		// Learn our own ident@host from anything the server attributes to us.
		if (msg.source?.user !== undefined && this.isSelf(msg.source.name)) {
			this.ident = msg.source.user;

			if (msg.source.host) {
				this.host = msg.source.host;
			}
		}

		if (interceptBatchLine(this, msg)) {
			return;
		}

		// Our own JOIN (live, not replayed) is what triggers a history load;
		// the reference for a catch-up is the newest message before the JOIN.
		const selfJoin =
			msg.command === "JOIN" &&
			!this.replayContext &&
			msg.source !== undefined &&
			this.isSelf(msg.source.name);
		const joinName = selfJoin ? msg.params[0] ?? "" : "";
		const beforeJoin: MsgRef | undefined = selfJoin
			? this.findChannel(joinName)?.newestRef
			: undefined;

		const handler = handlers.get(msg.command) ?? unhandled;

		try {
			handler(this, msg);
		} catch (err: unknown) {
			// eslint-disable-next-line no-console
			console.error(`[irc] handler for ${msg.command} failed on: ${msg.raw}`, err);
		}

		if (selfJoin) {
			const chan = this.findChannel(joinName);

			if (chan) {
				requestChannelHistory(this, chan, beforeJoin);
			}
		}
	}

	/** `@time` tag as a Date, or now. */
	timeOf(msg: IrcMessage): Date {
		const tag = msg.tags.get("time");

		if (tag) {
			const time = new Date(tag);

			if (!Number.isNaN(time.getTime())) {
				return time;
			}
		}

		return new Date();
	}

	/** Record a nick change of our own and tell the UI. */
	setNick(nick: string): void {
		this.nick = nick;
		this.bus.dispatch("nick", {network: this.uuid, nick});
	}

	/** Record the network name from ISUPPORT and rename the lobby. */
	setNetworkName(name: string): void {
		if (name === this.networkName) {
			return;
		}

		this.networkName = name;
		this.lobby.shared.name = name;
		this.bus.dispatch("network:name", {uuid: this.uuid, name});
	}

	// -------------------------------------------------------------- helpers

	dispatch: EventBus["dispatch"] = (event, ...args) => this.bus.dispatch(event, ...args);

	casefold(s: string): string {
		return casefold(s, this.isupport.casemapping);
	}

	namesEqual(a: string, b: string): boolean {
		return namesEqual(a, b, this.isupport.casemapping);
	}

	isSelf(nick: string): boolean {
		return this.namesEqual(nick, this.nick);
	}

	isChannelName(name: string): boolean {
		return name.length > 0 && this.isupport.chantypes.includes(name[0]);
	}

	/** Position of a prefix symbol in PREFIX (0 = most privileged); unknown → large. */
	prefixRank(symbol: string): number {
		const idx = this.isupport.prefix.symbols.indexOf(symbol);
		return idx === -1 ? 1000 : idx;
	}

	/** Whether `text` mentions our nick or a custom highlight keyword. */
	isHighlight(text: string): boolean {
		const {keywords, exceptions} = this.options.highlights?.() ?? {
			keywords: [],
			exceptions: [],
		};
		return isHighlight(text, this.nick, keywords, exceptions);
	}

	findChannel(name: string): Channel | undefined {
		return this.channels.find((chan) => this.namesEqual(chan.name, name));
	}

	channelById(id: number): Channel | undefined {
		return this.channels.find((chan) => chan.id === id);
	}

	/**
	 * Create a channel/query and insert it alphabetically after the lobby
	 * (the index is what `join` needs; always >= 1).
	 */
	createChannel(
		name: string,
		type: ChanType,
		options: {state?: ChanState; key?: string} = {}
	): {channel: Channel; index: number} {
		const channel = new Channel(
			this.ids.chanId(),
			name,
			type,
			(s) => this.casefold(s),
			options
		);
		let index = this.channels.length;

		for (let i = 1; i < this.channels.length; i++) {
			const other = this.channels[i];
			const sortable = other.type === ChanType.CHANNEL || other.type === ChanType.QUERY;

			if (!sortable || compareNames(name, other.name) <= 0) {
				index = i;
				break;
			}
		}

		this.channels.splice(index, 0, channel);
		return {channel, index};
	}

	/** Create + announce (`join` event) a channel or query. */
	announceChannel(
		name: string,
		type: ChanType,
		options: {state?: ChanState; key?: string; shouldOpen?: boolean} = {}
	): Channel {
		const {channel, index} = this.createChannel(name, type, options);
		this.bus.dispatch("join", {
			network: this.uuid,
			chan: channel.snapshot(),
			index,
			shouldOpen: options.shouldOpen ?? false,
		});
		return channel;
	}

	/** Drop a channel from the model and the UI (`part` event). */
	removeChannel(chan: Channel): void {
		const idx = this.channels.indexOf(chan);

		if (idx > 0) {
			this.channels.splice(idx, 1);
		}

		if (this.activeChanId === chan.id) {
			this.activeChanId = 0;
		}

		this.bus.dispatch("part", {chan: chan.id});
	}

	/**
	 * Allocate an id, keep the unread counters and dispatch `msg`. Mirrors
	 * `Chan.pushMessage` in the old server.
	 */
	pushMessage(chan: Channel, partial: Partial<SharedMsg>, increasesUnread = false): SharedMsg {
		const msg: SharedMsg = {
			users: [],
			...partial,
			id: 0,
			time: partial.time ?? new Date(),
		};

		if (this.replayContext) {
			// History replay: collect, the caller allocates ids and delivers.
			this.replayContext.collected.push({chan, msg});
			return msg;
		}

		msg.id = this.ids.msgId();
		chan.newestRef = chan.remember(msg);
		const shared = chan.shared;
		shared.totalMessages++;

		if (msg.self) {
			shared.unread = 0;
			shared.highlight = 0;
			shared.firstUnread = msg.id;
		} else if (chan.id !== this.activeChanId) {
			if (!shared.firstUnread) {
				shared.firstUnread = msg.id;
			}

			if (increasesUnread || msg.highlight) {
				shared.unread++;
			}

			if (msg.highlight) {
				shared.highlight++;
			}
		}

		this.bus.dispatch("msg", {
			chan: chan.id,
			msg,
			unread: shared.unread,
			highlight: shared.highlight,
		});
		return msg;
	}

	/**
	 * Run `fn` with every `pushMessage` collected instead of dispatched, and
	 * handlers told (via {@link replaying}) to skip state side effects. Used
	 * to turn a chathistory batch into messages (history.ts).
	 */
	collectReplay(target: Channel, fn: () => void): ReplayedMessage[] {
		const previous = this.replayContext;
		const context = {target, collected: [] as ReplayedMessage[]};
		this.replayContext = context;

		try {
			fn();
		} finally {
			this.replayContext = previous;
		}

		return context.collected;
	}

	/** True inside {@link collectReplay}: handlers must not touch channel state. */
	get replaying(): boolean {
		return this.replayContext !== null;
	}

	/** The channel whose history is being replayed (for QUIT/NICK, which name none). */
	get replayTarget(): Channel | undefined {
		return this.replayContext?.target;
	}

	/** Ids for `count` older messages, below everything shown so far (see ids.ts). */
	historyIds(count: number): number[] {
		return this.ids.historyIds(count);
	}

	/** Tell the UI a channel's user list changed (it will ask `names`). */
	usersChanged(chan: Channel): void {
		this.bus.dispatch("users", {chan: chan.id});
	}
}

// ----------------------------------------------------------------- utilities

function compareNames(a: string, b: string): number {
	return a.localeCompare(b, undefined, {sensitivity: "base"});
}

function sanitizeIdent(nick: string): string {
	const ident = nick.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 10);
	return ident || "seance";
}

/** `host[:port][/path]` with an optional scheme → hostname only. */
function hostnameOf(host: string): string {
	const stripped = host.replace(/^(?:wss?|https?|ircs?):\/\//i, "");
	const slash = stripped.indexOf("/");
	return slash === -1 ? stripped : stripped.slice(0, slash);
}

export function buildUrl(host: string, port: number, tls: boolean): string {
	const stripped = host.trim().replace(/^(?:wss?|https?|ircs?):\/\//i, "");
	const slash = stripped.indexOf("/");
	let hostname = slash === -1 ? stripped : stripped.slice(0, slash);
	const path = slash === -1 ? "/" : stripped.slice(slash);

	if (hostname.includes(":") && !hostname.startsWith("[")) {
		hostname = `[${hostname}]`; // bare IPv6 literal
	}

	return `${tls ? "wss" : "ws"}://${hostname}:${port}${path}`;
}

/** A readable, stable id so per-network preferences survive reloads. */
export function deriveUuid(host: string, port: number, nick: string): string {
	const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9.-]+/g, "_");
	return `${clean(hostnameOf(host))}-${port}-${clean(nick)}`;
}

/** `"#a key, b, #c"` → channels with optional keys; a missing prefix gets `#`. */
export function parseJoinList(join: string): {name: string; key: string}[] {
	const result: {name: string; key: string}[] = [];

	for (const entry of join.split(",")) {
		const [rawName, key = ""] = entry.trim().split(/\s+/);

		if (!rawName) {
			continue;
		}

		const name = CHANNEL_PREFIXES.includes(rawName[0]) ? rawName : `#${rawName}`;

		if (!result.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
			result.push({name, key});
		}
	}

	return result;
}
