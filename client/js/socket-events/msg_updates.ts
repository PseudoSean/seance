// Consumers for the message-update events of docs/resources/bus-contract.md
// §1.4 and the pending-copy settlement of §1.7. The IRC layer only
// dispatches these after the `msg` they refer to, with the target already
// resolved to a store id, so a miss here means the message was trimmed from
// the buffer and there is nothing to update.
import socket from "../socket";
import {store} from "../store";
import {
	applyEdit,
	applyReaction,
	applyRedaction,
	findMessageById,
	removePending,
} from "../helpers/messageUpdates";

function lookup(chan: number, id: number) {
	const target = store.getters.findChannel(chan);

	if (!target) {
		return undefined;
	}

	return findMessageById(target.channel.messages, id);
}

socket.on("msg:react", function (data) {
	const message = lookup(data.chan, data.id);

	if (message) {
		applyReaction(message, data.text, data.nick, data.remove);
	}
});

socket.on("msg:redact", function (data) {
	const message = lookup(data.chan, data.id);

	if (message) {
		applyRedaction(message, {by: data.by, reason: data.reason, time: data.time});
	}
});

socket.on("msg:edit", function (data) {
	const message = lookup(data.chan, data.replaces);

	if (message) {
		applyEdit(message, data.id);
	}

	const target = store.getters.findChannel(data.chan);

	// If the user was replying to or editing the replaced message, follow the
	// edit so the compose bar does not point at a hidden message.
	if (target && message) {
		const replacement = findMessageById(target.channel.messages, data.id);

		if (target.channel.replyTo === message) {
			target.channel.replyTo = replacement ?? null;
		}

		if (target.channel.editing === message) {
			target.channel.editing = replacement ?? null;
		}
	}
});

socket.on("msg:settled", function (data) {
	const target = store.getters.findChannel(data.chan);

	if (target) {
		removePending(target.channel.messages, data.id);
	}
});
