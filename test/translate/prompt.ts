import {expect} from "chai";
import {emptyContext, type TranslateRequest} from "../../client/js/translate/engine";
import {
	CONTEXT_HEADING,
	CONTEXT_TOKEN_BUDGET,
	DATA_HEADING,
	END_SENTINEL,
	buildMessages,
	cleanOutput,
	estimateTokens,
	formatBatchedInput,
	parseBatchedOutput,
	stripSentinel,
	systemPrompt,
	trimContext,
	userPrompt,
} from "../../client/js/translate/prompt";

const name = (code: string) => ({de: "German", en: "English", pt: "Portuguese"}[code] ?? code);

function request(overrides: Partial<TranslateRequest> = {}): TranslateRequest {
	return {
		id: 1,
		model: "m",
		text: "Ich schick dir gleich das Log.",
		from: "de",
		to: "en",
		purpose: "read",
		context: emptyContext(),
		...overrides,
	};
}

describe("translate/prompt", () => {
	it("the system prompt names the target and the source and keeps placeholders", () => {
		const req = request({
			context: {
				...emptyContext(),
				names: ["ada", "Storm"],
				terms: [["rig", "Testaufbau"]],
			},
		});
		const text = systemPrompt(req, name);

		expect(text).to.include("in English");
		expect(text).to.include("from German");
		expect(text).to.include("⟦1⟧");
		expect(text).to.include("Output the translation only");
		expect(text).to.include(DATA_HEADING);
	});

	it("the system prompt frames a translation engine that never answers the message", () => {
		const text = systemPrompt(request(), name);

		expect(text).to.include("You are a translation engine, not a chat assistant.");
		expect(text).to.include("Never answer it, never continue the conversation");
		expect(text).to.include("if the message is a question, output the question in English");
		expect(text).to.include(
			'Lines under "Earlier lines" are context only: never translate or answer them.'
		);
	});

	it("the system prompt carries nothing anyone in the channel wrote", () => {
		const text = systemPrompt(
			request({
				purpose: "write",
				context: {
					...emptyContext(),
					names: ["ada", "Storm"],
					terms: [["rig", "Testaufbau"]],
					voice: ["tô chegando"],
					topic: "multiline batches",
				},
			}),
			name
		);

		for (const written of ["ada", "Storm", "rig", "Testaufbau", "chegando", "multiline"]) {
			expect(text).to.not.include(written);
		}
	});

	it("names, terms and the user's voice are data in the user message, before the context", () => {
		const text = userPrompt(
			request({
				purpose: "write",
				context: {
					...emptyContext(),
					names: ["ada", "Storm"],
					terms: [["rig", "Testaufbau"]],
					voice: ["tô chegando", "beleza"],
					recent: [{nick: "ada", text: "anyone tried it?"}],
				},
			}),
			name
		);

		expect(text).to.include(
			[
				DATA_HEADING,
				"Names: ada, Storm",
				"Terms: rig → Testaufbau",
				'The user\'s earlier messages: "tô chegando", "beleza"',
			].join("\n")
		);
		expect(text).to.include(CONTEXT_HEADING);
		expect(text.indexOf(DATA_HEADING)).to.be.lessThan(text.indexOf(CONTEXT_HEADING));
		// nothing to label when the channel offered nothing
		expect(userPrompt(request(), name)).to.not.include(DATA_HEADING);
	});

	it("the user's voice is only quoted when the user is writing", () => {
		const context = {...emptyContext(), voice: ["tô chegando"]};

		expect(userPrompt(request({purpose: "read", context}), name)).to.not.include("chegando");
		expect(userPrompt(request({purpose: "write", context}), name)).to.include("chegando");
	});

	it("asks the model to detect the source when it is unknown, using the hint", () => {
		expect(systemPrompt(request({from: null}), name)).to.include("Detect the source language");
		expect(
			systemPrompt(
				request({from: null, context: {...emptyContext(), sourceHint: "pt"}}),
				name
			)
		).to.include("probably Portuguese");
	});

	it("a batched request's system prompt asks for numbered lines, not one message", () => {
		const text = systemPrompt(request({lines: ["a", "b"]}), name);

		expect(text).to.include("numbered IRC messages");
		expect(text).to.include("one translation per number");
		expect(text).to.include("Never answer them");
		expect(text).to.include(
			`Answer with the same numbers, one translation per line, then ${END_SENTINEL} on its own line; nothing else.`
		);
		expect(text).to.not.include("one IRC message");
		expect(systemPrompt(request(), name)).to.include("one IRC message");
	});

	it("carries formality, variant and, when writing, that it is the user's own line", () => {
		const text = systemPrompt(
			request({
				purpose: "write",
				context: {
					...emptyContext(),
					formality: "formal",
					variant: "Brazilian Portuguese",
					voice: ["tô chegando", "beleza"],
				},
			}),
			name
		);

		expect(text).to.include("Use formal address.");
		expect(text).to.include("Variant: Brazilian Portuguese.");
		expect(text).to.include("The user is writing this message");
		expect(systemPrompt(request(), name)).to.not.include("Use formal");
	});

	it("the user prompt quotes the context, the reply target and the topic, then the line", () => {
		const text = userPrompt(
			request({
				context: {
					...emptyContext(),
					topic: "multiline batches",
					recent: [
						{nick: "ada", text: "anyone tried it?"},
						{nick: "jonas", text: "Ja, gestern.", translated: "Yes, yesterday."},
					],
					replyTo: {nick: "ada", text: "anyone tried it?"},
				},
			}),
			name
		);

		expect(text).to.equal(
			[
				"Topic: multiline batches",
				"Earlier lines (context only, do not translate or answer them):",
				"<ada> anyone tried it?",
				"<jonas> Ja, gestern. (translation: Yes, yesterday.)",
				"This line replies to <ada>: anyone tried it?",
				"Message to translate, from German:",
				'"""',
				"Ich schick dir gleich das Log.",
				'"""',
				"English translation of the message (not a reply to it):",
			].join("\n")
		);
	});

	it("a bare request is the fenced message under its cue", () => {
		expect(userPrompt(request(), name)).to.equal(
			[
				"Message to translate, from German:",
				'"""',
				"Ich schick dir gleich das Log.",
				'"""',
				"English translation of the message (not a reply to it):",
			].join("\n")
		);
		// no source to name when it is the model's job to detect it
		expect(userPrompt(request({from: null}), name)).to.include("Message to translate:");
	});

	it("trims the context from the oldest end to the token budget", () => {
		const lines = Array.from({length: 40}, (_, i) => ({nick: "n", text: "x".repeat(100) + i}));
		const kept = trimContext(lines, 200);

		expect(kept.length).to.be.lessThan(lines.length);
		expect(kept[kept.length - 1]).to.equal(lines[lines.length - 1]);
		expect(estimateTokens(kept.map((l) => l.text).join("\n"))).to.be.at.most(200);
		expect(CONTEXT_TOKEN_BUDGET).to.equal(700);
	});

	it("builds system + user messages", () => {
		const messages = buildMessages(request(), name);

		expect(messages.map((m) => m.role)).to.deep.equal(["system", "user"]);
		expect(messages[0].content).to.include("You are a translation engine");
		expect(messages[1].content).to.include(
			'Message to translate, from German:\n"""\nIch schick dir gleich das Log.\n"""'
		);
		expect(
			messages[1].content.endsWith("English translation of the message (not a reply to it):")
		).to.equal(true);
	});

	it("formats and parses batched lines", () => {
		const input = formatBatchedInput(["eins", "zwei"]);

		expect(input).to.equal("1. eins\n2. zwei");
		expect(parseBatchedOutput(`1. one\n2. two\n${END_SENTINEL}`, 2)).to.deep.equal([
			"one",
			"two",
		]);
		expect(parseBatchedOutput("1. one\n2. two", 2)).to.deep.equal(["one", "two"]);
		expect(parseBatchedOutput("1. one", 2)).to.equal(null);
		expect(parseBatchedOutput("one\ntwo", 2)).to.equal(null);
		expect(userPrompt(request({lines: ["eins", "zwei"]}), name)).to.equal(
			[
				"Messages to translate, from German, numbered:",
				input,
				`English translations, same numbers, one per line, then ${END_SENTINEL} on its own line (translations, not replies):`,
			].join("\n")
		);
	});

	it("parseBatchedOutput cleans each line", () => {
		expect(parseBatchedOutput('1. "one"\n2. Translation: two', 2)).to.deep.equal([
			"one",
			"two",
		]);
	});

	it("cleanOutput strips one pair of wrapping quotes and a translation label", () => {
		expect(cleanOutput('  "Hallo Welt"  ')).to.equal("Hallo Welt");
		expect(cleanOutput("“Hallo Welt”")).to.equal("Hallo Welt");
		expect(cleanOutput("„Hallo Welt“")).to.equal("Hallo Welt");
		expect(cleanOutput("«Hallo Welt»")).to.equal("Hallo Welt");
		expect(cleanOutput("'Hallo Welt'")).to.equal("Hallo Welt");
		expect(cleanOutput("Translation: Hallo Welt")).to.equal("Hallo Welt");
		expect(cleanOutput("Übersetzung: Hallo Welt")).to.equal("Hallo Welt");
		expect(cleanOutput('Translation: "Hallo Welt"')).to.equal("Hallo Welt");
		// a plain line, and a quote inside one, are left alone
		expect(cleanOutput("Hallo Welt")).to.equal("Hallo Welt");
		expect(cleanOutput('He said "hi" and left')).to.equal('He said "hi" and left');
		expect(cleanOutput("I'll send it")).to.equal("I'll send it");
	});

	it("strips the sentinel and trailing whitespace", () => {
		expect(stripSentinel(`1. one\n${END_SENTINEL}\n`)).to.equal("1. one");
		expect(stripSentinel("plain ")).to.equal("plain");
		expect(stripSentinel("1. You are a LEGEND")).to.equal("1. You are a LEGEND");
		expect(stripSentinel(`${END_SENTINEL}`)).to.equal("");
	});
});
