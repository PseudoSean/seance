/**
 * `PERSISTENCE` replies (draft/persistence, see ../persistence.ts):
 *
 *   :server PERSISTENCE STATUS <client-setting> <effective>
 *        — `ON|OFF|DEFAULT` (what the user asked for) then `ON|OFF` (what
 *          the server will actually do). Sent unsolicited between 005 and
 *          the MOTD end, after a SET, and for `/persistence status`.
 *          nefarious2 sent the effective state alone before 7a47da1, so
 *          the effective state is read as the *last* parameter.
 *   :server PERSISTENCE SET ON|OFF|DEFAULT      (the ack; a STATUS follows)
 *   :server PERSISTENCE REPLAY STATUS <client-setting> <effective>
 *   :server PERSISTENCE ATTACH <profile>        (the ack of our ATTACH)
 *   :server PERSISTENCE DETACH|PROFILE …
 *
 * Only the effective state matters to us ({@link IrcClient.persistenceHold},
 * read at the end of registration by ../persistence.ts). The registration
 * line is not shown; anything the user asked for is. The `ATTACH` ack of the
 * catch-up cursor we offered before `CAP END` is silent too — it only says
 * the server will replay the gap itself.
 */

import type {Handler} from "../types";

const persistence: Handler = (client, msg) => {
	const [sub = "", ...rest] = msg.params;
	const what = sub.toUpperCase();

	if (what === "STATUS") {
		const effective = (rest[rest.length - 1] ?? "").toUpperCase();
		const setting = rest.length > 1 ? rest[0].toUpperCase() : "";
		client.persistenceHold = effective === "ON";

		if (client.state === "registering") {
			return; // the unsolicited line; the user did not ask for it
		}

		client.pushMessage(client.lobby, {
			text:
				"Session persistence (the server keeps you in your channels while " +
				`disconnected): ${effective}${
					setting && setting !== effective ? ` (your setting: ${setting})` : ""
				}`,
		});
		return;
	}

	if (what === "ATTACH" && client.attachCursor !== undefined && client.state === "registering") {
		// Our cursor was taken: the server drives the catch-up from it, so
		// catchup.ts stands down for the channels it restores.
		client.serverReplay = true;
		return;
	}

	if (what === "SET") {
		// The ack of what we asked for; the STATUS that follows carries the
		// state the server will act on. Our own registration-time auto-enable
		// (../persistence.ts persistenceEnableLine) is silent — the user never
		// typed anything.
		if (client.state === "registering") {
			return;
		}

		client.pushMessage(client.lobby, {
			text: `Session persistence set to: ${(rest[0] ?? "").toUpperCase()}`,
		});
		return;
	}

	client.pushMessage(client.lobby, {text: `Persistence: ${msg.params.join(" ")}`});
};

export default {PERSISTENCE: persistence};
