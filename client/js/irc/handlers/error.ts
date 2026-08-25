/**
 * ERROR (`ERROR :Closing Link: ...`). The server drops the connection right
 * after; the transport's close event does the state change. After our own
 * QUIT the transport is already closed by us, so the (1006) close that
 * follows never reconnects; otherwise the reason is shown and the usual
 * reconnect kicks in.
 */

import {MessageType} from "../../../../shared/types/msg";
import type {Handler} from "../types";

const error: Handler = (client, msg) => {
	if (client.isQuitting) {
		return;
	}

	client.pushMessage(
		client.lobby,
		{type: MessageType.ERROR, time: client.timeOf(msg), text: msg.params[0] ?? "ERROR"},
		true
	);
};

export default {ERROR: error};
