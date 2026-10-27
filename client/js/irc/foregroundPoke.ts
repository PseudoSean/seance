/**
 * The foreground poke: the app is back in front of the user (the page shown
 * again, the window focused, the network back, a shell resumed), so every
 * connection is asked to be up now rather than when its schedule says.
 * Vue-free and DOM-free so mocha can drive it; manager.ts `reconnectAll`
 * hands it the clients. Tests: test/irc/foregroundPoke.ts.
 *
 * Per transport state:
 *
 * - `reconnect-wait`: dial now (`client.connect()`, which restarts the
 *   schedule in the transport).
 * - `connecting`, past {@link STALE_DIAL_MS}: a dial started while the OS had
 *   the radio off can sit there for a minute; start over now (`redial`).
 * - `connecting`, younger: let it run, but restart the schedule
 *   (`restartSchedule`). After a long suspension the retry timer that was
 *   due is overdue and fires the moment the page thaws, often just before
 *   the poke and before the radio is back; without the restart that dial's
 *   failure waited out the backoff built up in the background — up to the
 *   60 s cap — with the user looking at the screen.
 * - `open`: ask the socket for a sign of life within
 *   {@link FOREGROUND_PROBE_MS} (`probe`); the OS often killed it without a
 *   close event.
 *
 * Signals come in clusters (visibility + focus + pageshow + a shell's own),
 * so a poke within {@link POKE_INTERVAL_MS} of the last does nothing — each
 * would otherwise dial, and the dial ledger counts every dial. `online` is
 * not part of a cluster but news (the radio is back, a dial can now get
 * through), so it is `forced` past that.
 */

import type {Transport} from "./types";

/** Foreground signals arrive in clusters; one poke per second is plenty. */
export const POKE_INTERVAL_MS = 1000;
/** probe() deadline for the foreground poke (the transport's default is 10 s). */
export const FOREGROUND_PROBE_MS = 4_000;
/** A dial older than this at foreground time is presumed stuck. */
export const STALE_DIAL_MS = 3_000;

export interface Pokeable {
	readonly transport: Transport;
	connect(): void;
}

let lastPokeAt = -Infinity;

/** Forget the last poke (tests). */
export function resetPokeClock(): void {
	lastPokeAt = -Infinity;
}

/** Poke every client; returns false when the de-bounce swallowed it. */
export function pokeAll(clients: Iterable<Pokeable>, now: number, force = false): boolean {
	if (!force && now - lastPokeAt < POKE_INTERVAL_MS) {
		return false;
	}

	lastPokeAt = now;

	for (const client of clients) {
		pokeOne(client);
	}

	return true;
}

function pokeOne(client: Pokeable): void {
	const transport = client.transport;

	switch (transport.state) {
		case "reconnect-wait":
			client.connect();
			break;
		case "connecting":
			if (
				transport.connectingForMs &&
				transport.redial &&
				transport.connectingForMs() > STALE_DIAL_MS
			) {
				transport.redial();
			} else {
				transport.restartSchedule?.();
			}

			break;
		case "open":
			if (transport.probe) {
				// Shorter than the background probe: the user is looking at the
				// screen, and a live server answers a PING well within this.
				transport.probe(FOREGROUND_PROBE_MS);
			} else {
				transport.send("PING :resume");
			}

			break;
		default:
			// `closed`: the user or a final failure ended it; not ours to undo.
			break;
	}
}
