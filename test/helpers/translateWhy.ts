import {expect} from "chai";
import {before, describe, it} from "mocha";
import enCatalog from "../../client/locales/en.json";
import {setCatalog} from "../../client/js/i18n/core";
import {translateWhyText} from "../../client/js/helpers/translateWhy";
import {translateErrorText} from "../../client/js/helpers/translateErrors";
import type {RouteBlock} from "../../client/js/translate/router";
import {buildCatalog, type DeviceReason} from "../../client/js/translate/models";
import {TRANSLATION_UNAVAILABLE} from "../../client/js/translate/service";
import {needsDownloadError} from "../../client/js/translate/consent";
import friendlysize from "../../client/js/helpers/friendlysize";
import {ABORTED, TIMED_OUT} from "../../client/js/translate/outgoing";
import {CONTEXT_OVERFLOW} from "../../client/js/translate/engine";

// The rule reports codes (models.ts modelBlock, router.ts explainRoute and
// translationBlock); these two helpers turn them into the sentences every
// surface shows. availability.ts pins the codes, this pins the mapping: a
// code that falls to the wrong sentence (a new device reason read as "no
// WebGPU", both engines off read as the GPU's alone) ships with a green
// suite otherwise.
const en = enCatalog as Record<string, string>;

describe("translateWhyText", () => {
	before(() => {
		setCatalog("en", enCatalog, undefined);
	});

	const cases: Array<[RouteBlock, string]> = [
		[{kind: "disabled"}, "translate.settings.disabled"],
		[{kind: "probing"}, "translate.why.probing"],
		[{kind: "off", engine: "llm"}, "translate.why.llmOff"],
		[{kind: "off", engine: "seq2seq"}, "translate.why.cpuOff"],
		[{kind: "off", engine: "all"}, "translate.why.allOff"],
		[{kind: "down"}, "translate.why.down"],
		[{kind: "unserved"}, "translate.why.unserved"],
		[{kind: "off", engine: "nllb"}, "translate.why.nllbOff"],
		[{kind: "source"}, "translate.why.unserved"],
	];

	for (const [block, key] of cases) {
		it(`says ${key} for ${JSON.stringify(block)}`, () => {
			expect(translateWhyText(block)).to.equal(en[key]);
		});
	}

	it("has a sentence of its own for every device reason", () => {
		const reasons: Record<DeviceReason, string> = {
			NO_WEBGPU: "translate.why.noWebgpu",
			INSECURE_ORIGIN: "translate.why.insecureOrigin",
			NO_ADAPTER: "translate.why.noAdapter",
			NO_F16: "translate.why.noF16",
			GPU_LIMITS: "translate.why.gpuLimits",
			NO_WASM_SIMD: "translate.why.noWasmSimd",
			PROBE_FAILED: "translate.why.probeFailed",
		};

		for (const [reason, key] of Object.entries(reasons)) {
			expect(
				translateWhyText({kind: "device", reason: reason as DeviceReason}),
				reason
			).to.equal(en[key]);
		}

		// Seven reasons, seven sentences: none falls to another's.
		expect(new Set(Object.values(reasons).map((key) => en[key])).size).to.equal(7);
	});

	it("says a phone cannot hold a model", () => {
		expect(translateWhyText({kind: "memory", needed: 3_400_000_000})).to.equal(
			en["translate.why.phoneMemory"]
		);
	});

	it("names both sizes of a buffer that is too small", () => {
		const text = translateWhyText({
			kind: "buffer",
			needed: 148.4 * 1024 * 1024,
			limit: 128 * 1024 * 1024,
		});

		expect(text).to.equal("Needs a GPU buffer of 148.4 MiB; this device binds at most 128 MiB");
	});
});

describe("translateErrorText", () => {
	before(() => {
		setCatalog("en", enCatalog, undefined);
	});

	it("says a request too long for the model's window is too long", () => {
		expect(translateErrorText(CONTEXT_OVERFLOW)).to.equal(en["translate.error.tooLong"]);
	});

	it("says why nothing could take the request when the caller knows", () => {
		expect(
			translateErrorText(TRANSLATION_UNAVAILABLE, () => en["translate.why.cpuOff"])
		).to.equal(en["translate.why.cpuOff"]);
	});

	it("falls back to the generic sentence without an explanation", () => {
		expect(translateErrorText(TRANSLATION_UNAVAILABLE)).to.equal(
			en["translate.error.unavailable"]
		);
		// An explanation that has nothing to say does not blank the line.
		expect(translateErrorText(TRANSLATION_UNAVAILABLE, () => "")).to.equal(
			en["translate.error.unavailable"]
		);
	});

	it("keeps a load error's own detail, and an engine's text as it is", () => {
		expect(translateErrorText(`${TRANSLATION_UNAVAILABLE}: out of memory`)).to.equal(
			"no translation engine can take this request: out of memory"
		);
		expect(translateErrorText("WebGPU device lost")).to.equal("WebGPU device lost");
	});

	it("words a declined download with the model and its size, as the router's reason does", () => {
		const ref = buildCatalog().llm;
		const expected = en["translate.why.needsDownload"]
			.replace("{model}", en["translate.model.llm"].replace("{name}", "Qwen3 1.7B"))
			.replace("{size}", friendlysize(ref.sizeBytes));

		expect(translateErrorText(needsDownloadError(ref))).to.equal(expected);
		expect(translateWhyText({kind: "download", ref})).to.equal(expected);
		expect(expected).to.include("Qwen3 1.7B").and.include("MiB");
	});

	it("names an OPUS-MT pair by its languages", () => {
		const ref = buildCatalog().opus["de-en"];

		expect(translateErrorText(needsDownloadError(ref))).to.include(
			en["translate.model.opus"].replace("{from}", "German").replace("{to}", "English")
		);
	});

	it("words the queue's own codes", () => {
		expect(translateErrorText(TIMED_OUT)).to.equal(en["translate.error.timedOut"]);
		expect(translateErrorText(ABORTED)).to.equal(en["translate.error.aborted"]);
	});
});
