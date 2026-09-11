import {expect} from "chai";
import {emptyContext, type TranslateRequest} from "../../client/js/translate/engine";
import {
	CONTEXT_TOKEN_BUDGET,
	DATA_HEADING,
	END_SENTINEL,
	buildMessages,
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

		expect(text).to.include("into English");
		expect(text).to.include("from German");
		expect(text).to.include("⟦1⟧");
		expect(text).to.include("Reply with the translation only");
		expect(text).to.include(DATA_HEADING);
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
			})
		);

		expect(text).to.include(
			[
				DATA_HEADING,
				"Names: ada, Storm",
				"Terms: rig → Testaufbau",
				'The user\'s earlier messages: "tô chegando", "beleza"',
			].join("\n")
		);
		expect(text.indexOf(DATA_HEADING)).to.be.lessThan(text.indexOf("Context:"));
		// nothing to label when the channel offered nothing
		expect(userPrompt(request())).to.not.include(DATA_HEADING);
	});

	it("the user's voice is only quoted when the user is writing", () => {
		const context = {...emptyContext(), voice: ["tô chegando"]};

		expect(userPrompt(request({purpose: "read", context}))).to.not.include("chegando");
		expect(userPrompt(request({purpose: "write", context}))).to.include("chegando");
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

	it("a batched request's system prompt asks for numbered lines, not just the final message", () => {
		const text = systemPrompt(request({lines: ["a", "b"]}), name);

		expect(text).to.include("each numbered line");
		expect(text).to.not.include("only the final message");
		expect(systemPrompt(request(), name)).to.include("only the final message");
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
			})
		);

		expect(text).to.equal(
			[
				"Topic: multiline batches",
				"Context:",
				"<ada> anyone tried it?",
				"<jonas> Ja, gestern. (translation: Yes, yesterday.)",
				"This line replies to <ada>: anyone tried it?",
				"Translate: Ich schick dir gleich das Log.",
			].join("\n")
		);
	});

	it("a bare request is just the line", () => {
		expect(userPrompt(request())).to.equal("Translate: Ich schick dir gleich das Log.");
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
		expect(messages[1].content).to.include("Translate: Ich schick");
	});

	it("formats and parses batched lines", () => {
		const input = formatBatchedInput(["eins", "zwei"]);

		expect(input).to.equal(
			`Translate each numbered line; answer with the same numbers, then ${END_SENTINEL} on its own line:\n1. eins\n2. zwei`
		);
		expect(parseBatchedOutput(`1. one\n2. two\n${END_SENTINEL}`, 2)).to.deep.equal([
			"one",
			"two",
		]);
		expect(parseBatchedOutput("1. one\n2. two", 2)).to.deep.equal(["one", "two"]);
		expect(parseBatchedOutput("1. one", 2)).to.equal(null);
		expect(parseBatchedOutput("one\ntwo", 2)).to.equal(null);
		expect(userPrompt(request({lines: ["eins", "zwei"]}))).to.equal(input);
	});

	it("strips the sentinel and trailing whitespace", () => {
		expect(stripSentinel(`1. one\n${END_SENTINEL}\n`)).to.equal("1. one");
		expect(stripSentinel("plain ")).to.equal("plain");
		expect(stripSentinel("1. You are a LEGEND")).to.equal("1. You are a LEGEND");
		expect(stripSentinel(`${END_SENTINEL}`)).to.equal("");
	});
});
