/**
 * `PERSISTENCE` replies (draft/persistence, see ../persistence.ts):
 *
 *   :server PERSISTENCE STATUS ON|OFF   — unsolicited between 005 and the
 *                                         MOTD end, or answering `/persistence status`
 *   :server PERSISTENCE SET ON|OFF|DEFAULT
 *   :server PERSISTENCE PROFILE …
 *
 * The registration-time STATUS only sets `client.persistenceHold`; anything
 * the user asked for is shown in the lobby.
 */

import type {Handler} from "../types";

const persistence: Handler = (client, msg) => {
	const [sub = "", value = ""] = msg.params;
	const what = sub.toUpperCase();

	if (what === "STATUS" || what === "SET") {
		const state = value.toUpperCase();

		if (state === "ON") {
			client.persistenceHold = true;
		} else if (state === "OFF") {
			client.persistenceHold = false;
		}

		if (client.state === "registering") {
			return; // the unsolicited line; the user did not ask
		}

		client.pushMessage(client.lobby, {
			text: `Session persistence (the server keeps you in your channels while disconnected): ${value}`,
		});
		return;
	}

	client.pushMessage(client.lobby, {text: `Persistence: ${msg.params.join(" ")}`});
};

export default {PERSISTENCE: persistence};
