import {expect} from "chai";
import {emptyContext, PromptContext, TranslateRequest} from "../../client/js/translate/engine";
import {bareRetry, OutgoingRequest} from "../../client/js/translate/outgoing";
import {
	systemPrompt as systemPrompt17,
	userPrompt as userPrompt17,
} from "../../client/js/translate/prompt";
import {
	systemPrompt as systemPrompt4B,
	userPrompt as userPrompt4B,
} from "../../client/js/translate/prompts/qwen3-4b";

const name = (code: string) => (code === "en" ? "English" : code);

/** Everything a channel would put in a prompt, none of which a polish sends. */
function channelContext(): PromptContext {
	const context = emptyContext();

	context.topic = "release day";
	context.names = ["ada", "sean"];
	context.terms = [["rig", "Testaufbau"]];
	context.recent = [
		{nick: "sean", text: "Todavia estoy probando", translated: "I'm still testing."},
	];
	context.voice = ["I'm still testing."];

	return context;
}

function polish(text: string, context = channelContext()): TranslateRequest {
	return {id: 1, model: "m", text, from: "en", to: "en", purpose: "polish", context};
}

// Measured on the web build's 4B weights (2026-09-19,
// tmp/experiments/polish-context.ts): with the channel's names, terms or
// earlier lines above the line, the model stopped correcting -- 4 of 5 lines
// handed back as written, the fifth with the "Correct:" label copied in
// front; with nothing above it, 5 of 5 corrected. So a polish's prompt is
// the line and nothing else, whatever the request carries.
describe("translate/polish", () => {
	for (const [label, user, system] of [
		["Qwen3-1.7B", userPrompt17, systemPrompt17],
		["Qwen3-4B", userPrompt4B, systemPrompt4B],
	] as const) {
		it(`${label}: the prompt is the line alone, however full the context`, () => {
			expect(user(polish("corected text being sent hear"), name)).to.equal(
				"Correct: corected text being sent hear"
			);
			expect(user(polish("corected text being sent hear", emptyContext()), name)).to.equal(
				"Correct: corected text being sent hear"
			);
		});

		it(`${label}: the system prompt is the copy editor's, not the engine's`, () => {
			const text = system(polish("corected text being sent hear"), name);

			expect(text).to.include("Correct the user's English message");
			// The clause that makes it fix a word that is spelled right.
			expect(text).to.include("the wrong word for the sentence");
			expect(text).to.include("comes back unchanged");
			expect(text).to.not.include("translation engine");
			// The sentence about the data block and the earlier lines stays
			// in: it was part of the wording measured, and a polish sends
			// neither, so it says nothing about this request either way.
		});

		it(`${label}: a translation still carries the channel's context`, () => {
			const text = user({...polish("hallo"), purpose: "read", from: "de", to: "en"}, name);

			expect(text).to.include("Earlier lines");
			expect(text).to.include("Translate into English: hallo");
		});
	}

	// A polish can still fail as a narration or a loop, and the bare retry
	// must stay a polish: same purpose, so the copy editor's prompt; the
	// source kept as the routing hint, so `resolveRoute` still takes the
	// same-language branch to the LLM (router.ts) instead of finding no route.
	it("the retry of a polish is still a polish, and still routable", () => {
		const request: OutgoingRequest = {
			text: "corected text being sent hear",
			from: "en",
			to: "en",
			purpose: "polish",
			context: channelContext(),
			batches: false,
		};
		const retry = bareRetry(request);

		expect(retry.purpose).to.equal("polish");
		expect(retry.hint).to.equal("en");
		expect(retry.to).to.equal("en");
		expect(retry.context.recent).to.deep.equal([]);
		expect(retry.context.names).to.deep.equal([]);
	});
});
