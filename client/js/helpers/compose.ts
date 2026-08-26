// Per-channel reply/edit compose state (ClientChan.replyTo / .editing).
// Shared by the message action bar, ChatInput and the `msg:edit` consumer.
// Reply and edit are mutually exclusive: starting one clears the other.
import {MessageType} from "../../../shared/types/msg";
import type {ClientChan, ClientMessage} from "../types";

export function focusInput() {
	const input = document.getElementById("input") as HTMLTextAreaElement | null;

	if (!input) {
		return;
	}

	input.focus();
	// Put the caret at the end (edit pre-fills the text).
	const end = input.value.length;
	input.setSelectionRange(end, end);
}

export function startReply(channel: ClientChan, message: ClientMessage) {
	if (!message.msgid) {
		return;
	}

	channel.editing = null;
	channel.replyTo = message;
	focusInput();
}

export function startEdit(channel: ClientChan, message: ClientMessage) {
	if (!message.msgid || !message.self) {
		return;
	}

	channel.replyTo = null;
	channel.editing = message;
	channel.pendingMessage = message.text ?? "";
	channel.inputHistoryPosition = 0;
	focusInput();
}

export function cancelCompose(channel: ClientChan) {
	if (channel.editing) {
		channel.editing = null;
		channel.pendingMessage = "";
	}

	channel.replyTo = null;
}

/** Newest own plain message with a msgid that can still be edited. */
export function findLastEditable(channel: ClientChan): ClientMessage | undefined {
	for (let i = channel.messages.length - 1; i >= 0; i--) {
		const m = channel.messages[i];

		if (
			m.self &&
			m.msgid &&
			m.type === MessageType.MESSAGE &&
			!m.redacted &&
			m.supersededBy === undefined
		) {
			return m;
		}
	}

	return undefined;
}
