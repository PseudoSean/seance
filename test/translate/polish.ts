import {expect} from "chai";
import {emptyContext, TranslateRequest} from "../../client/js/translate/engine";
import {
	ONLY_THE_CORRECTION as CORRECTION_17,
	ONLY_THE_TRANSLATION as TRANSLATION_17,
	systemPrompt as systemPrompt17,
	userPrompt as userPrompt17,
} from "../../client/js/translate/prompt";
import {
	ONLY_THE_CORRECTION as CORRECTION_4B,
	ONLY_THE_TRANSLATION as TRANSLATION_4B,
	systemPrompt as systemPrompt4B,
	userPrompt as userPrompt4B,
} from "../../client/js/translate/prompts/qwen3-4b";

const name = (code: string) => (code === "en" ? "English" : code);

function polish(text: string): TranslateRequest {
	const context = emptyContext();

	context.names = ["ada"];
	context.recent = [
		{nick: "me", text: "Todavia estoy probando", translated: "I'm still testing."},
	];
	context.voice = ["I'm still testing."];

	return {id: 1, model: "m", text, from: "en", to: "en", purpose: "polish", context};
}

// A polish keeps the channel's context (it says which word is meant where
// the draft's is doubtful) but is told, in the correction's own words, what
// to output: with "Output only the translation of the last message" above
// the earlier lines, the model corrected an earlier line's translation
// instead of the draft (2026-09-18).
describe("translate/polish", () => {
	for (const [label, user, system, correction, translation] of [
		["Qwen3-1.7B", userPrompt17, systemPrompt17, CORRECTION_17, TRANSLATION_17],
		["Qwen3-4B", userPrompt4B, systemPrompt4B, CORRECTION_4B, TRANSLATION_4B],
	] as const) {
		it(`${label}: the user turn keeps the context, ends with the line, and asks for the correction`, () => {
			const text = user(polish("corected text being sent hear"), name);

			expect(text).to.include("Earlier lines");
			expect(text).to.include("Todavia estoy probando");
			expect(text).to.include(correction);
			expect(text).to.not.include(translation);
			expect(text.endsWith("Correct: corected text being sent hear")).to.equal(true);
		});

		it(`${label}: the system prompt is the copy editor's and rules the earlier lines out`, () => {
			const text = system(polish("corected text being sent hear"), name);

			expect(text).to.include("Correct the spelling, grammar and punctuation");
			expect(text).to.include("never to be corrected or repeated");
			expect(text).to.not.include("translation engine");
		});
	}
});
