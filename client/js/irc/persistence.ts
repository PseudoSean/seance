/**
 * `draft/persistence` — nefarious2's built-in bouncer, from the client's
 * side. While a logged-in user's session is "held", a dropped connection
 * leaves no channel: the next connection with the same account resumes the
 * session and, right behind the MOTD, the server replays the membership it
 * kept as a `BATCH +ref draft/persistence` of JOIN (with the original
 * `@time`/`msgid`), 332/333, MARKREAD and NAMES per channel
 * (`bouncer_session.c` `bounce_send_channel_state`). A client that
 * requested the cap is also told between 005 and the MOTD end whether it is
 * held at all: `:server PERSISTENCE STATUS ON|OFF`.
 *
 * Seance uses this to make a reconnect look like nothing happened:
 *
 * - the replayed JOIN / topic / NAMES update the model without producing
 *   lines (`IrcClient.restoring`, honoured by join.ts and topic.ts) and each
 *   restored JOIN starts the usual paced `CHATHISTORY AFTER` catch-up
 *   (catchup.ts), which is what actually fills the gap;
 * - after `STATUS ON` the autojoin `JOIN` waits for that batch (or
 *   {@link RESTORE_WAIT_MS}, whichever is first) and then covers only the
 *   channels the server did not restore. JOINing a channel the server is
 *   restoring anyway is ignored at best and, while another client of the
 *   account is attached, answered with a second topic + NAMES burst.
 *
 * Without the cap (another ircd, hold off, not logged in) nothing here runs
 * and a re-JOIN is quiet by `Channel.rejoining` alone.
 */

import type {IrcClient} from "./client";
import type {BatchHandler} from "./handlers/batch";

/** How long after the MOTD end a held session's restoration is waited for. */
export const RESTORE_WAIT_MS = 2000;
/** …and how long after the last sign of one (an unbatched burst arriving line by line). */
export const RESTORE_QUIET_MS = 750;
/** Hard ceiling: the autojoin is never held longer than this. */
export const RESTORE_MAX_WAIT_MS = 8000;

interface RestoreState {
	timer: ReturnType<typeof setTimeout> | null;
	/** No extension past this point, whatever keeps arriving. */
	deadline: number;
}

const states = new WeakMap<IrcClient, RestoreState>();

function stateOf(client: IrcClient): RestoreState {
	let state = states.get(client);

	if (!state) {
		state = {timer: null, deadline: 0};
		states.set(client, state);
	}

	return state;
}

/** True while the autojoin is held back for a restoration batch (tests). */
export function awaitingRestoration(client: IrcClient): boolean {
	return stateOf(client).timer !== null;
}

/**
 * True while the connection is still settling into a held session: from the
 * end of registration until RESTORE_MAX_WAIT_MS later, whether or not the
 * autojoin is still waiting. What the bouncer says in that window is setup
 * chatter, not news for the user.
 */
export function inRestorationWindow(client: IrcClient): boolean {
	return Date.now() < stateOf(client).deadline;
}

/**
 * Registration completed with `PERSISTENCE STATUS ON`: hold the autojoin
 * until the server's restoration has been applied, or until
 * RESTORE_WAIT_MS pass without a sign of one (nothing was held after all).
 */
export function awaitRestoration(client: IrcClient): void {
	const state = stateOf(client);

	if (state.timer !== null) {
		return;
	}

	state.deadline = Date.now() + RESTORE_MAX_WAIT_MS;
	arm(client, state, RESTORE_WAIT_MS);
}

/**
 * A sign that the server is restoring our session right now: one of its
 * JOINs, or a bouncer NOTE. The batch is delivered as a unit, but an
 * unbatched burst (no `batch` cap, or a second burst after an alias attach)
 * arrives line by line, so the wait is extended to a quiet period instead —
 * JOINing a channel the server is about to give back is what makes it
 * answer with a second topic + NAMES burst.
 */
export function noteRestorationActivity(client: IrcClient): void {
	const state = stateOf(client);

	if (state.timer === null) {
		return; // not waiting: a live join, or the autojoin already went out
	}

	arm(client, state, RESTORE_QUIET_MS);
}

function arm(client: IrcClient, state: RestoreState, delay: number): void {
	if (state.timer !== null) {
		clearTimeout(state.timer);
	}

	const wait = Math.max(0, Math.min(delay, state.deadline - Date.now()));
	state.timer = setTimeout(() => {
		state.timer = null;
		client.autojoin();
	}, wait);
}

/** Transport closed: a pending autojoin dies with the connection. */
export function cancelRestoration(client: IrcClient): void {
	const state = stateOf(client);
	state.deadline = 0;
	clearWait(state);
}

/** Stop waiting, but stay in the settling window (see {@link inRestorationWindow}). */
function clearWait(state: RestoreState): void {
	if (state.timer !== null) {
		clearTimeout(state.timer);
		state.timer = null;
	}
}

/**
 * The `draft/persistence` batch: run its lines through the normal handlers
 * in restoring mode (state only, no lines), then JOIN whatever the server
 * did not give back — if the autojoin was waiting for this.
 */
export const persistenceBatch: BatchHandler = (client, batch) => {
	const state = stateOf(client);
	const waiting = state.timer !== null;
	clearWait(state);
	client.restoring = true;

	try {
		for (const msg of batch.messages) {
			client.handleMessage(msg);
		}
	} finally {
		client.restoring = false;
	}

	if (waiting) {
		client.autojoin();
	}
};
