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
