/**
 * WEBPUSH (IRCv3 draft/webpush — docs/projects/push-subscription.md).
 *
 * Only the server's acknowledgements arrive here: a successful
 * `WEBPUSH REGISTER|UNREGISTER <endpoint>` is an echo of our own line, and
 * failures come as `FAIL WEBPUSH …` (routed from handlers/standard-replies.ts).
 * Both become `webpush:state` for webpush.ts / the Settings UI; nothing is
 * shown in the timeline — the subscription state lives in one place.
 *
 * Spec: https://github.com/ircv3/ircv3-specifications/pull/471
 */

import type {Handler} from "../types";

const webpush: Handler = (client, msg) => {
	// params exclude the command: ["REGISTER", endpoint] / ["UNREGISTER", endpoint]
	const action = (msg.params[0] ?? "").toUpperCase();

	// WEBPUSH LIST: a run of `LIST <armed> <cur> <endpoint>` data lines then a
	// `LIST * <count>` terminator (endpoint is last and space-free). Rows
	// accumulate on the client; the terminator flushes them as one event.
	if (action === "LIST") {
		const first = msg.params[1] ?? "";

		if (first === "*") {
			client.webpushListEnd();
			return;
		}

		const endpoint = msg.params[3] ?? "";

		if (endpoint !== "") {
			client.webpushListRow({
				endpoint,
				armed: parseInt(first, 10) || 0,
				current: (msg.params[2] ?? "") === "1",
			});
		}

		return;
	}

	const endpoint = msg.params[1] ?? "";

	if ((action !== "REGISTER" && action !== "UNREGISTER") || endpoint === "") {
		return; // malformed echo; nothing to report
	}

	client.dispatch("webpush:state", {
		network: client.uuid,
		action,
		endpoint,
		ok: true,
	});
};

export default {WEBPUSH: webpush};
