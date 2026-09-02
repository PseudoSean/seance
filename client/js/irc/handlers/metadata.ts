/**
 * METADATA lines (draft/metadata-2 echoes of our own account writes, e.g.
 * the webpush payload tier / mute list set from webpush.ts). Silent: the
 * settings live in one place and the acks carry nothing the user asked for.
 */
import type {Handler} from "../types";

const metadata: Handler = (client, msg) => {
	void client;
	void msg;
};

export default {METADATA: metadata};
