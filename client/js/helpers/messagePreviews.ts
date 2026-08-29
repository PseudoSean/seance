// Attaches the client-side media previews (helpers/mediaPreview.ts) to a
// message coming off the bus. Both live messages (socket-events/msg.ts) and
// chathistory batches (socket-events/more.ts) go through here, so scrollback
// previews look exactly like live ones.
import {store} from "../store";
import {buildMediaPreviews} from "./mediaPreview";
import type {SharedMsg} from "../../../shared/types/msg";

export function attachMediaPreviews(msg: SharedMsg): void {
	if (!msg.text || msg.previews?.length) {
		return;
	}

	msg.previews = buildMediaPreviews(msg.text, {
		media: store.state.settings.media,
		allowHttp: window.location.protocol === "http:",
	});
}
