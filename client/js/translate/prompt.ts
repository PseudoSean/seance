// Prompt assembly for the LLM (spec § prompt.ts). The system message is
// short (WebLLM has no prompt cache, so every token is paid on every
// request); the context goes in the user message, labelled and quoted,
// trimmed from the oldest end to `CONTEXT_TOKEN_BUDGET`. Batched requests
// are numbered lines in and out, closed by `END_SENTINEL`.

import {ContextLine, TranslateRequest} from "./engine";
import {placeholder} from "./spans";

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export const CONTEXT_TOKEN_BUDGET = 700;
export const END_SENTINEL = "END";

/** Four characters per token: a rough but stable estimate for budgeting. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export function trimContext(lines: ContextLine[], budget: number): ContextLine[] {
	const kept = [...lines];

	while (kept.length > 0 && estimateTokens(kept.map(contextLine).join("\n")) > budget) {
		kept.shift();
	}

	return kept;
}

function contextLine(line: ContextLine): string {
	const base = `<${line.nick}> ${line.text}`;

	return line.translated ? `${base} (translation: ${line.translated})` : base;
}

export function systemPrompt(req: TranslateRequest, name: (code: string) => string): string {
	const c = req.context;
	const parts: string[] = [];
	const source = req.from
		? `from ${name(req.from)}`
		: c.sourceHint
		? `from the language it is written in (probably ${name(c.sourceHint)})`
		: "from the language it is written in";

	parts.push(
		`You translate chat messages from an IRC channel ${source} into ${name(req.to)}.`,
		req.from ? "" : "Detect the source language yourself.",
		"Translate only the final message; earlier lines are context.",
		`Keep placeholders like ${placeholder(
			1
		)}, nicknames, channel names and anything after # exactly as they are.`,
		"Keep the register: a short casual line stays short and casual.",
		"Reply with the translation only, no quotes, no explanation."
	);

	if (c.names.length > 0) {
		parts.push(`Names, not words: ${c.names.join(", ")}.`);
	}

	if (c.terms.length > 0) {
		parts.push(
			`Earlier in this channel: ${c.terms.map(([a, b]) => `${a} → ${b}`).join("; ")}.`
		);
	}

	if (c.formality === "formal") {
		parts.push("Use formal address.");
	} else if (c.formality === "casual") {
		parts.push("Use casual address.");
	}

	if (c.variant) {
		parts.push(`Variant: ${c.variant}.`);
	}

	if (req.purpose === "write") {
		parts.push("The user is writing this message; keep their voice.");

		if (c.voice.length > 0) {
			parts.push(`Their earlier messages: ${c.voice.map((v) => `"${v}"`).join(", ")}.`);
		}
	}

	return parts.filter((p) => p !== "").join(" ");
}

export function formatBatchedInput(lines: string[]): string {
	return [
		`Translate each numbered line; answer with the same numbers, then ${END_SENTINEL} on its own line:`,
		...lines.map((line, i) => `${i + 1}. ${line}`),
	].join("\n");
}

export function userPrompt(req: TranslateRequest): string {
	const c = req.context;
	const parts: string[] = [];

	if (c.topic) {
		parts.push(`Topic: ${c.topic}`);
	}

	const recent = trimContext(c.recent, CONTEXT_TOKEN_BUDGET);

	if (recent.length > 0) {
		parts.push("Context:", ...recent.map(contextLine));
	}

	if (c.replyTo) {
		parts.push(`This line replies to <${c.replyTo.nick}>: ${c.replyTo.text}`);
	}

	parts.push(req.lines ? formatBatchedInput(req.lines) : `Translate: ${req.text}`);

	return parts.join("\n");
}

export function buildMessages(
	req: TranslateRequest,
	name: (code: string) => string
): ChatMessage[] {
	return [
		{role: "system", content: systemPrompt(req, name)},
		{role: "user", content: userPrompt(req)},
	];
}

export function stripSentinel(text: string): string {
	return text.replace(new RegExp(`(?:^|\\n)${END_SENTINEL}\\s*$`), "").trimEnd();
}

/** `null` when the count or the numbering does not match: the caller falls back to one line at a time. */
export function parseBatchedOutput(text: string, count: number): string[] | null {
	const lines = stripSentinel(text)
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l !== "");
	const out: string[] = [];

	for (const line of lines) {
		const match = /^(\d+)\.\s*(.*)$/.exec(line);

		if (!match || Number(match[1]) !== out.length + 1) {
			return null;
		}

		out.push(match[2]);
	}

	return out.length === count ? out : null;
}
