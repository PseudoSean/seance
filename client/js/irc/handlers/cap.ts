/**
 * CAP: delegated to the CapNegotiator (LS/ACK/NAK during registration,
 * NEW/DEL afterwards via `cap-notify`); we only send what it tells us to.
 */

import {MessageType} from "../../../../shared/types/msg";
import type {Handler} from "../types";

const cap: Handler = (client, msg) => {
	const result = client.caps.handle(msg);

	for (const line of result.send) {
		client.send(line);
	}

	if (result.error) {
		client.pushMessage(client.lobby, {type: MessageType.ERROR, text: result.error}, true);
	}
};

export default {CAP: cap};
