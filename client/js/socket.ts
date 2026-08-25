// Typed in-process event bus that replaces the Socket.IO client.
//
// The API intentionally mirrors the subset of the socket.io-client surface
// that the rest of the client used (`on`, `once`, `off`, `emit`, `connect`,
// `disconnect`, `open`) so existing call sites keep working unchanged.
//
// Direction of travel:
//   - `on/once/off` subscribe to *server-to-client* events (things the
//     transport layer will `dispatch` at us once one exists).
//   - `emit` sends *client-to-server* events. There is no transport yet, so
//     an emit is delivered to whatever `handle`r has been registered for that
//     event (the future IRC layer will register those). Emits that nobody
//     handles are logged with `console.warn` so regressions are easy to spot.
//
// There is deliberately no networking in here. See docs/projects/initial_conversion.md.

import type {ServerToClientEvents, ClientToServerEvents} from "../../shared/types/socket-events";

type AnyHandler = (...args: any[]) => void | Promise<void>;

export type ServerEvent = keyof ServerToClientEvents;
export type ClientEvent = keyof ClientToServerEvents;

type ServerEventArgs<E extends ServerEvent> = Parameters<ServerToClientEvents[E]>;
type ClientEventArgs<E extends ClientEvent> = Parameters<ClientToServerEvents[E]>;

// Handlers may be async; the bus never awaits them (same as socket.io did).
export type ServerEventHandler<E extends ServerEvent> = (
	...args: ServerEventArgs<E>
) => void | Promise<void>;
export type ClientEventHandler<E extends ClientEvent> = (
	...args: ClientEventArgs<E>
) => void | Promise<void>;

export class EventBus {
	private listeners = new Map<ServerEvent, Set<AnyHandler>>();
	private handlers = new Map<ClientEvent, AnyHandler>();
	private isConnected = false;

	/** Whether `connect()` has been called without a matching `disconnect()`. */
	get connected(): boolean {
		return this.isConnected;
	}

	/** Subscribe to a server-to-client event. */
	on<E extends ServerEvent>(event: E, callback: ServerEventHandler<E>): this {
		let set = this.listeners.get(event);

		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}

		set.add(callback);
		return this;
	}

	/** Subscribe to a server-to-client event for a single delivery. */
	once<E extends ServerEvent>(event: E, callback: ServerEventHandler<E>): this {
		const wrapper: ServerEventHandler<E> = (...args: ServerEventArgs<E>) => {
			this.off(event, wrapper);
			void callback(...args);
		};

		return this.on(event, wrapper);
	}

	/** Unsubscribe from a server-to-client event. Omit `callback` to remove all listeners. */
	off<E extends ServerEvent>(event: E, callback?: ServerEventHandler<E>): this {
		if (!callback) {
			this.listeners.delete(event);
			return this;
		}

		this.listeners.get(event)?.delete(callback);
		return this;
	}

	/**
	 * Send a client-to-server event. With no transport attached this is routed
	 * to the `handle`r registered for the event, or warns if there is none.
	 */
	emit<E extends ClientEvent>(event: E, ...args: ClientEventArgs<E>): this {
		const handler = this.handlers.get(event);

		if (handler) {
			void handler(...args);
			return this;
		}

		// eslint-disable-next-line no-console
		console.warn("[bus] unhandled emit:", event, ...args);
		return this;
	}

	/**
	 * Register the (single) handler that services a client-to-server event.
	 * This is how the transport layer, or a local stand-in for it, plugs in.
	 */
	handle<E extends ClientEvent>(event: E, handler: ClientEventHandler<E>): this {
		this.handlers.set(event, handler);
		return this;
	}

	/** Remove the handler for a client-to-server event. */
	unhandle<E extends ClientEvent>(event: E): this {
		this.handlers.delete(event);
		return this;
	}

	/**
	 * Deliver a server-to-client event to all subscribers. Returns whether
	 * anybody was listening.
	 */
	dispatch<E extends ServerEvent>(event: E, ...args: ServerEventArgs<E>): boolean {
		const set = this.listeners.get(event);

		if (!set || set.size === 0) {
			return false;
		}

		// Copy so that listeners removing themselves (see `once`) don't
		// disturb iteration.
		for (const listener of Array.from(set)) {
			void listener(...args);
		}

		return true;
	}

	/** Number of subscribers for an event; mostly useful in tests. */
	listenerCount(event: ServerEvent): number {
		return this.listeners.get(event)?.size ?? 0;
	}

	/** No-op placeholder; the real transport arrives in a later phase. */
	connect(): this {
		this.isConnected = true;
		return this;
	}

	/** Alias of `connect()` kept for socket.io API compatibility. */
	open(): this {
		return this.connect();
	}

	/** No-op placeholder; the real transport arrives in a later phase. */
	disconnect(): this {
		this.isConnected = false;
		return this;
	}

	/** Drop every listener and handler. Mostly useful in tests. */
	removeAllListeners(): this {
		this.listeners.clear();
		this.handlers.clear();
		return this;
	}
}

const socket = new EventBus();

// Ease debugging during development
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
	window.socket = socket;
}

declare global {
	interface Window {
		socket: EventBus;
	}
}

export default socket;
