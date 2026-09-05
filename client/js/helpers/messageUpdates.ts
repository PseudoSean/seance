// Pure store mutations for the `msg:react` / `msg:redact` / `msg:edit` bus
// events (docs/resources/bus-contract.md §1.4). Kept free of store/DOM
// imports so they can be unit-tested under mocha; the bus consumer in
// socket-events/msg_updates.ts only looks the message up and calls these.
import type {MsgReaction, MsgRedaction, SharedMsg} from "../../../shared/types/msg";

/** Newest-first lookup: updates almost always target recent messages. */
export function findMessageById<T extends SharedMsg>(messages: T[], id: number): T | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].id === id) {
			return messages[i];
		}
	}

	return undefined;
}

/**
 * Add or remove `nick`'s reaction `text`. A nick appears at most once per
 * text; entries keep first-seen order and disappear when nobody is left.
 * Arrays are replaced rather than mutated so watchers see one change.
 */
export function applyReaction(message: SharedMsg, text: string, nick: string, remove: boolean) {
	const reactions: MsgReaction[] = message.reactions ?? [];
	const index = reactions.findIndex((r) => r.text === text);
	const lower = nick.toLowerCase();

	if (remove) {
		if (index === -1) {
			return;
		}

		const nicks = reactions[index].nicks.filter((n) => n.toLowerCase() !== lower);

		if (nicks.length === reactions[index].nicks.length) {
			return;
		}

		const next = reactions.slice();

		if (nicks.length === 0) {
			next.splice(index, 1);
		} else {
			next[index] = {text, nicks};
		}

		message.reactions = next.length ? next : undefined;
		return;
	}

	if (index === -1) {
		message.reactions = reactions.concat([{text, nicks: [nick]}]);
		return;
	}

	if (reactions[index].nicks.some((n) => n.toLowerCase() === lower)) {
		return;
	}

	const next = reactions.slice();
	next[index] = {text, nicks: reactions[index].nicks.concat([nick])};
	message.reactions = next;
}

/** Mark a message deleted; `text` is kept so the UI can offer click-to-reveal. */
export function applyRedaction(message: SharedMsg, redaction: MsgRedaction) {
	message.redacted = {
		by: redaction.by,
		reason: redaction.reason,
		time: redaction.time,
	};
}

/** Hide `oldMessage` in favour of the newer message `newId`. */
export function applyEdit(oldMessage: SharedMsg, newId: number) {
	oldMessage.supersededBy = newId;
}

/**
 * Text and nick for a reply quote, from the parent message. Returns
 * `undefined` when the parent is not loaded (the UI shows "(unknown message)").
 */
export function replyQuote(
	messages: SharedMsg[],
	msgid: string,
	maxLength = 80
): {nick: string; text: string; id: number} | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];

		if (m.msgid === msgid && m.supersededBy === undefined) {
			const text = (m.text ?? "").replace(/\s+/g, " ").trim();

			return {
				id: m.id,
				nick: m.from?.nick ?? "",
				text: text.length > maxLength ? text.slice(0, maxLength - 1) + "…" : text,
			};
		}
	}

	return undefined;
}

/**
 * The reactions `nick` has on `message`, in the order they are shown. The
 * picker marks these as selected and clicking one takes it back off, which is
 * the same toggle the badges under a message do.
 */
export function myReactions(message: SharedMsg, nick: string): string[] {
	const me = nick.toLowerCase();

	return (message.reactions ?? [])
		.filter((reaction) => reaction.nicks.some((n) => n.toLowerCase() === me))
		.map((reaction) => reaction.text);
}

/**
 * Add a delivered message to a channel's list. Pending copies of our own
 * outgoing messages (bus-contract §1.9) stay a trailing block — the slot
 * their echo will land in — so anything else goes in ahead of that block
 * and a new copy goes after it.
 */
export function insertMessage<T extends SharedMsg>(messages: T[], msg: T): void {
	if (msg.pending) {
		messages.push(msg);
		return;
	}

	let at = messages.length;

	while (at > 0 && messages[at - 1].pending) {
		at--;
	}

	messages.splice(at, 0, msg);
}

/** Take the pending copy `id` out of the list (`msg:settled`). */
export function removePending<T extends SharedMsg>(messages: T[], id: number): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].id === id) {
			if (!messages[i].pending) {
				return false;
			}

			messages.splice(i, 1);
			return true;
		}
	}

	return false;
}
