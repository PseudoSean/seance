/**
 * BATCH: start/end markers are swallowed; lines tagged `@batch=...` are still
 * delivered to their normal handlers, so playback shows up as ordinary
 * messages. Proper chathistory batching is phase D.
 */

import type {Handler} from "../types";

const batch: Handler = () => undefined;

export default {BATCH: batch};
