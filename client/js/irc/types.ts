/**
 * Shared types for the browser IRC layer (`client/js/irc/`).
 */

import type {IrcMessage} from "./message";
import type {IrcClient} from "./client";
import type {Channel} from "./channel";
import type {TransportEvent, TransportState} from "./transport";

/**
 * The slice of {@link WsTransport} the client relies on. Tests inject a fake
 * that implements just this.
 */
export interface Transport {
	readonly state: TransportState;
	on(listener: (ev: TransportEvent) => void): () => void;
	connect(): void;
	send(line: string): void;
	close(code?: number, reason?: string): void;
}

/**
 * Everything needed to open a connection. Populated by the connect form
 * (`client/components/Windows/Connect.vue`) and consumed by {@link IrcClient}.
 */
export type ConnectOptions = {
	/** Host name, optionally with a path (`irc.example.org/ws`). */
	host: string;
	port: number;
	tls: boolean;
	nick: string;
	/** Comma-separated channel list, optionally with keys (`#a key, #b`). */
	join: string;
	/** `external` is a stub: browsers cannot present client certificates over WebSocket. */
	sasl: "" | "plain" | "external";
	saslAccount: string;
	saslPassword: string;
	/**
	 * Drop the connection when SASL fails instead of carrying on unauthenticated
	 * (irc-framework's `sasl_disconnect_on_fail`; the old server left it off).
	 */
	saslDisconnectOnFail?: boolean;
};

/** Connection state as seen by the rest of the app. */
export type IrcClientState = "disconnected" | "connecting" | "registering" | "registered";

/**
 * An inbound handler: one per command / numeric, registered in
 * `handlers/index.ts`. Handlers mutate the client's model and dispatch bus
 * events through the client; they never touch the transport directly.
 */
export type Handler = (client: IrcClient, msg: IrcMessage) => void;

/** The channel (or lobby/query) an input line was typed into. */
export interface CommandContext {
	client: IrcClient;
	chan: Channel;
	/** Lower-cased command name without the slash (`msg`, `me`, ...). */
	cmd: string;
	/** Space-split arguments (may contain empty strings for repeated spaces). */
	args: string[];
	/** Everything after the command name, untrimmed. */
	rest: string;
}

/** An outbound (slash) command, registered in `commands/index.ts`. */
export interface Command {
	/** Names this command answers to, without the slash. */
	commands: string[];
	/** Whether the command may run while the network is disconnected. */
	allowDisconnected?: boolean;
	input: (ctx: CommandContext) => void;
}
