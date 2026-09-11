// Which incoming messages the reading pipeline considers (spec § Reading
// pipeline, 1): from someone else, not pending, a chat type, after the
// channel's switch-on time, and with enough words once URLs, code, emoji,
// formatting codes and nick mentions are gone. Vue-free.

export const MIN_WORDS = 3;

export interface EligibilityMsg {
	type?: string;
	self?: boolean;
	pending?: boolean;
	time: Date | number;
	text?: string;
}

const CHAT_TYPES = new Set(["message", "action", "notice"]);

// A shortcode body must contain at least one letter, but :+1: and :-1: are
// special cases.
const SHORTCODE = /:(?:[+-]1|(?=[a-z0-9_+-]*[a-z])[a-z0-9_+-]{2,}):/gi;

// eslint-disable-next-line no-misleading-character-class
const EMOJI = /[\p{Extended_Pictographic}‍️]/gu;

export function plainTextOf(text: string, nicks: string[]): string {
	const lower = new Set(nicks.map((nick) => nick.toLowerCase()));
	let out = text
		.replace(/`[^`\n]+`/g, " ")
		.replace(/\bhttps?:\/\/[^\s<>()]+/gi, " ")
		.replace(/\bwww\.[^\s<>()]+/gi, " ")
		.replace(SHORTCODE, " ")
		.replace(/\x03(?:\d{1,2}(?:,\d{1,2})?)?|[\x02\x0f\x11\x16\x1d\x1e\x1f]/g, "")
		.replace(EMOJI, " ");

	out = out
		.split(/\s+/)
		.filter((word) => {
			const bare = word.replace(/[:,]+$/, "").toLowerCase();

			return bare !== "" && !lower.has(bare);
		})
		.join(" ");

	return out.trim();
}

export function wordCount(text: string): number {
	return text
		.split(/\s+/)
		.map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
		.filter((word) => word !== "").length;
}

export function isEligible(msg: EligibilityMsg, opts: {since: number; nicks: string[]}): boolean {
	if (msg.self || msg.pending || !msg.type || !CHAT_TYPES.has(msg.type) || !msg.text) {
		return false;
	}

	const time = msg.time instanceof Date ? msg.time.getTime() : msg.time;

	if (time < opts.since) {
		return false;
	}

	return wordCount(plainTextOf(msg.text, opts.nicks)) >= MIN_WORDS;
}
