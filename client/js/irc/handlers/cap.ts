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

	if (result.naked.includes("sasl")) {
		// The AUTHENTICATE opener was pipelined behind the REQ (caps.ts);
		// without the cap it goes nowhere, so end negotiation ourselves.
		client.abortSasl("the server refused the sasl capability");
	}

	if (result.error) {
		client.pushMessage(client.lobby, {type: MessageType.ERROR, text: result.error}, true);
	}
};

export default {CAP: cap};
