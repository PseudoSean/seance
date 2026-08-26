// Consumer for the `typing` event of docs/resources/bus-contract.md §1.5:
// someone else's `+typing` TAGMSG in a loaded channel or query. Entries live
// in `ClientChan.typing` with an expiry; TypingIndicator.vue prunes expired
// ones while it is showing them.
//
// Layout rule (TypingIndicator.vue): the indicator line appears with the
// first entry and its space stays reserved (`typingReserved`) after the
// entries go, so the scrollback never shifts back down. The next message
// rendered in the channel releases the reservation in the same render, so
// the new line simply fills the space — MessageList.vue does that for the
// channel on screen (a hidden status message must not release it); here we
// only release for channels that are not being displayed. A message from
// the typist also ends their entry early, as does their part/quit/kick, and
// a nick change follows the rename — all of which arrive here as `msg`.
import socket from "../socket";
import {store} from "../store";
import {MessageType} from "../../../shared/types/msg";
import {applyTyping, removeTyping, renameTyping} from "../helpers/typingState";

socket.on("typing", function (data) {
	const target = store.getters.findChannel(data.chan);

	if (!target) {
		return;
	}

	const {channel} = target;
	channel.typing = applyTyping(channel.typing, data.nick, data.state, Date.now());

	if (channel.typing.length > 0 && !channel.typingReserved) {
		channel.typingReserved = true;
	}
});

// Runs after socket-events/msg.ts pushed the message (and possibly re-routed
// a showInActive notice to the active channel, hence the re-lookup).
socket.on("msg", function (data) {
	const target = store.getters.findChannel(data.chan);

	if (!target) {
		return;
	}

	const {channel} = target;
	const onScreen = store.state.activeChannel?.channel === channel;

	if (channel.typingReserved && !onScreen) {
		channel.typingReserved = false;
	}

	if (channel.typing.length === 0) {
		return;
	}

	const msg = data.msg;

	switch (msg.type) {
		case MessageType.NICK:
			if (msg.from?.nick && msg.new_nick) {
				channel.typing = renameTyping(channel.typing, msg.from.nick, msg.new_nick);
			}

			break;

		case MessageType.KICK:
			if (msg.target?.nick) {
				channel.typing = removeTyping(channel.typing, msg.target.nick);
			}

			break;

		default:
			if (msg.from?.nick && !msg.self) {
				channel.typing = removeTyping(channel.typing, msg.from.nick);
			}
	}
});
