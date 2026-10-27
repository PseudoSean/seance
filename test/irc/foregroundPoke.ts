/**
 * The foreground poke (irc/foregroundPoke.ts) over a real WsTransport and a
 * real dial ledger, on sinon's clock: what a phone sees when the app comes
 * back after a long time in the background.
 */
import {expect} from "chai";
import sinon from "ts-sinon";
import {WsTransport, TransportEvent} from "../../client/js/irc/transport";
import {dialGateFor, useStorageBackend} from "../../client/js/irc/dialLedger";
import {
	FOREGROUND_PROBE_MS,
	pokeAll,
	POKE_INTERVAL_MS,
	resetPokeClock,
	STALE_DIAL_MS,
} from "../../client/js/irc/foregroundPoke";

type Handler = (ev: unknown) => void;

class FakeWebSocket {
	// `object[]` because eslint's core no-use-before-define rejects a self-typed static.
	static instances: object[] = [];
	readonly OPEN = 1;
	readyState = 0;
	protocol = "";
	binaryType = "blob";
	sent: string[] = [];
	private handlers = new Map<string, Handler[]>();

	constructor(public url: string) {
		FakeWebSocket.instances.push(this);
	}

	addEventListener(type: string, handler: Handler): void {
		this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.readyState = 2;
	}

	open(): void {
		this.readyState = 1;
		this.dispatch("open", {});
	}

	closed(code = 1006): void {
		this.readyState = 3;
		this.dispatch("close", {code, reason: "", wasClean: false});
	}

	private dispatch(type: string, ev: unknown): void {
		(this.handlers.get(type) ?? []).forEach((h) => h(ev));
	}
}

const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1] as FakeWebSocket;

/** The real schedule (1 s → 60 s), without jitter so the waits can be pinned. */
const SCHEDULE = {
	enabled: true,
	initialDelayMs: 1000,
	maxDelayMs: 60_000,
	factor: 2,
	jitter: false,
};

function setup() {
	const transport = new WsTransport({
		url: "wss://irc.example/",
		WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
		reconnect: SCHEDULE,
		gate: dialGateFor("irc.example"),
	});
	const events: TransportEvent[] = [];
	transport.on((ev) => events.push(ev));
	const client = {transport, connect: () => transport.connect()};
	const waits = () =>
		events.filter((e) => e.type === "reconnecting") as Extract<
			TransportEvent,
			{type: "reconnecting"}
		>[];
	return {transport, client, waits};
}

/** Run `fn` with `navigator.onLine` reading `online()`. */
function withOnline(online: () => boolean, fn: () => void): void {
	const nav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
	Object.defineProperty(globalThis, "navigator", {
		get: () => ({onLine: online()}),
		configurable: true,
	});

	try {
		fn();
	} finally {
		if (nav) {
			Object.defineProperty(globalThis, "navigator", nav);
		} else {
			delete (globalThis as {navigator?: unknown}).navigator;
		}
	}
}

describe("foreground poke (irc/foregroundPoke.ts)", function () {
	let clock: sinon.SinonFakeTimers;
	let data: Map<string, string>;

	beforeEach(function () {
		FakeWebSocket.instances = [];
		clock = sinon.useFakeTimers();
		data = new Map();
		useStorageBackend({
			get: (key) => data.get(key) ?? null,
			set: (key, value) => void data.set(key, value),
			remove: (key) => void data.delete(key),
		});
		resetPokeClock();
	});

	afterEach(function () {
		clock.restore();
		useStorageBackend(null);
	});

	/** Lose the connection and fail every retry until the waits reach the cap (the app in the background). */
	function backgroundUntilCapped(waits: ReturnType<typeof setup>["waits"]): number {
		last().open();
		clock.tick(60_000);
		last().closed();

		for (let i = 0; i < 20 && waits()[waits().length - 1].delayMs < SCHEDULE.maxDelayMs; i++) {
			clock.tick(waits()[waits().length - 1].delayMs);
			last().closed();
		}

		const wait = waits()[waits().length - 1];
		expect(wait.delayMs, "the background retries reached the cap").to.equal(
			SCHEDULE.maxDelayMs
		);
		expect(wait.throttled).to.equal(undefined);
		return wait.delayMs;
	}

	it("after a long absence: the thawing page's overdue retry fails, and the next try is a second away, not a minute", function () {
		const {transport, client, waits} = setup();
		transport.connect();
		const capped = backgroundUntilCapped(waits);

		// The page thaws: the overdue retry timer fires first and dials…
		clock.tick(capped);
		const thawDial = FakeWebSocket.instances.length;
		expect(transport.state).to.equal("connecting");

		// …and the poke (visibilitychange) finds that young dial and lets it run.
		clock.tick(10);
		expect(pokeAll([client], Date.now())).to.equal(true);
		expect(FakeWebSocket.instances).to.have.length(thawDial);

		// The radio was not back yet: the dial fails at once.
		clock.tick(40);
		last().closed();
		const next = waits()[waits().length - 1];
		expect(next.delayMs).to.equal(SCHEDULE.initialDelayMs);
		expect(next.throttled).to.equal(undefined);

		// `online` half a second later is news, not part of the cluster: it
		// gets through the de-bounce and dials now.
		clock.tick(450);
		expect(pokeAll([client], Date.now()), "a cluster poke is de-bounced").to.equal(false);
		expect(pokeAll([client], Date.now(), true)).to.equal(true);
		expect(FakeWebSocket.instances).to.have.length(thawDial + 1);
		expect(transport.state).to.equal("connecting");

		last().open();
		expect(transport.state).to.equal("open");
	});

	it("dials that failed with the radio still off do not use up the server's throttle", function () {
		// Three failures in a row inside the server's window would make the
		// fourth dial wait ~42 s (dialLedger.ts) — but these never reached it.
		let online = true;
		withOnline(
			() => online,
			() => {
				const {transport, client, waits} = setup();
				transport.connect();
				last().open();
				clock.tick(60_000);
				// Suspended; the OS killed the socket. The page thaws and pokes;
				// the probe finds the socket dead and dials at once.
				pokeAll([client], Date.now());
				clock.tick(FOREGROUND_PROBE_MS);

				// Each dial goes out while the device still claims a network
				// and fails once it admits it has none.
				for (let i = 0; i < 3; i++) {
					online = true;
					const before = FakeWebSocket.instances.length;
					// A 0 ms retry runs on the next millisecond.
					clock.tick(Math.max(1, waits()[waits().length - 1].delayMs));
					expect(FakeWebSocket.instances, `dial ${i + 1}`).to.have.length(before + 1);
					online = false;
					last().closed();
				}

				expect(
					JSON.parse(data.get("thelounge.state.dials") ?? "{}")["irc.example"].d,
					"only the first, accepted dial is on record"
				).to.deep.equal([0]);

				online = true;
				clock.tick(POKE_INTERVAL_MS);
				expect(pokeAll([client], Date.now(), true)).to.equal(true);
				const dial = waits()[waits().length - 1];
				expect(dial.throttled, "not held for the server's throttle").to.equal(undefined);
				expect(transport.state).to.equal("connecting");
			}
		);
	});

	it("still waits out the server's throttle for dials that reached it", function () {
		// The same three quick failures with the device online may have been
		// refused at the accept: the ledger keeps them, and the fourth waits.
		const {transport, client, waits} = setup();
		transport.connect();
		last().closed();

		for (let i = 0; i < 2; i++) {
			clock.tick(waits()[waits().length - 1].delayMs);
			last().closed();
		}

		clock.tick(POKE_INTERVAL_MS);
		pokeAll([client], Date.now());
		expect(waits()[waits().length - 1].throttled).to.equal(true);
	});

	it("starts a stuck dial over, probes an open socket, and leaves a closed network alone", function () {
		const stuck = setup();
		stuck.transport.connect();
		clock.tick(STALE_DIAL_MS + 1);
		pokeAll([stuck.client], Date.now());
		expect(FakeWebSocket.instances).to.have.length(2);

		const open = setup();
		open.transport.connect();
		last().open();
		clock.tick(POKE_INTERVAL_MS);
		pokeAll([open.client], Date.now());
		expect(last().sent).to.deep.equal(["PING :probe"]);

		const closed = setup();
		const connect = sinon.spy(closed.client, "connect");
		clock.tick(POKE_INTERVAL_MS);
		pokeAll([closed.client], Date.now());
		expect(connect.called).to.equal(false);
	});
});
