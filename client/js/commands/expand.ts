import {store} from "../store";

export function input(): boolean {
	if (!store.state.activeChannel) {
		return false;
	}

	const messageIds: number[] = [];

	for (const message of store.state.activeChannel.channel.messages) {
		let toggled = false;

		for (const preview of message.previews || []) {
			if (!preview.shown) {
				preview.shown = true;
				toggled = true;
			}
		}

		if (toggled) {
			messageIds.push(message.id);
		}
	}

	// Preview state is local; messageIds is kept for parity with /collapse
	return messageIds.length >= 0;
}
