// The one rule for "can this run here, and if not why": models.ts
// `modelBlock` per model, router.ts `explainRoute` per pair and
// `translationBlock` for translation as a whole. Settings, the composer's
// dialog, the panel and the toolbar disable exactly what the router would
// refuse, so the explanation is tested against the router itself.

import {expect} from "chai";
import type {Capability} from "../../client/js/translate/capability";
import {
	LLM_CHOICES,
	LLM_MIN_BUFFER_BYTES,
	QWEN3_1_7B_ID,
	QWEN3_4B_ID,
	buildCatalog,
	modelBlock,
	selectLlm,
	type EngineSwitches,
} from "../../client/js/translate/models";
import {routesFor} from "../../client/js/translate/routes.default";
import {
	explainRoute,
	resolveRoute,
	routeInput,
	translationBlock,
	type RouteTable,
} from "../../client/js/translate/router";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

function cap(overrides: Partial<Capability>): Capability {
	return {
		tier: "gpu",
		reasons: [],
		f16: true,
		maxBufferBytes: 2 * GiB,
		deviceMemoryGiB: 8,
		storageQuotaBytes: null,
		mobile: false,
		...overrides,
	};
}

/** The five devices the browser scenario stubs, and two more the probe can report. */
const DEVICES: Record<string, Capability> = {
	noWebgpu: cap({tier: "cpu", reasons: ["NO_WEBGPU"], f16: false, maxBufferBytes: 0}),
	noF16: cap({tier: "cpu", reasons: ["NO_F16"], f16: false}),
	binds128: cap({tier: "cpu", reasons: ["SMALL_BUFFER"], maxBufferBytes: 128 * MiB}),
	binds160: cap({maxBufferBytes: 160 * MiB}),
	desktop: cap({}),
	noSimd: cap({
		tier: "none",
		reasons: ["NO_WEBGPU", "NO_WASM_SIMD"],
		f16: false,
		maxBufferBytes: 0,
	}),
	probeFailed: cap({tier: "none", reasons: ["PROBE_FAILED"], f16: false, maxBufferBytes: 0}),
};

const on: EngineSwitches = {llm: true, cpu: true, nllb: true};
const small = LLM_CHOICES.find((ref) => ref.id === QWEN3_1_7B_ID)!;
const large = LLM_CHOICES.find((ref) => ref.id === QWEN3_4B_ID)!;
const base = buildCatalog();
const nllb = base.nllb;

// The pair rows the shipped table has in kind: a pair both engines serve,
// one only the LLM does (a language NLLB measured badly in), and one where
// an OPUS pair shares the LLM's class.
const table: RouteTable = {
	"*": {"*": ["llm", "nllb"]},
	en: {"*": ["llm", "nllb"], de: [["llm", "opus:de-en"], "nllb"]},
	fil: {"*": ["llm"]},
};

describe("translate availability", () => {
	describe("modelBlock", () => {
		it("is probing until the probe answers, and disabled on a deploy that switched it off", () => {
			expect(modelBlock(small, null, on)).to.deep.equal({kind: "probing"});
			expect(modelBlock(nllb, DEVICES.desktop, on, false)).to.deep.equal({kind: "disabled"});
		});

		it("lets every model run on a desktop GPU with both switches on", () => {
			for (const ref of [small, large, nllb, base.opus["de-en"]]) {
				expect(modelBlock(ref, DEVICES.desktop, on), ref.id).to.equal(null);
			}
		});

		it("names the device code for a GPU model, never the buffer when f16 is missing", () => {
			expect(modelBlock(small, DEVICES.noWebgpu, on)).to.deep.equal({
				kind: "device",
				reason: "NO_WEBGPU",
			});
			expect(modelBlock(large, DEVICES.noF16, on)).to.deep.equal({
				kind: "device",
				reason: "NO_F16",
			});
			expect(
				modelBlock(small, cap({tier: "cpu", reasons: ["INSECURE_ORIGIN"]}), on)
			).to.deep.equal({kind: "device", reason: "INSECURE_ORIGIN"});
			expect(modelBlock(small, DEVICES.probeFailed, on)).to.deep.equal({
				kind: "device",
				reason: "PROBE_FAILED",
			});
		});

		it("gives each GPU model its own buffer numbers, on a cpu-tier device too", () => {
			// 128 MiB: the tier is cpu (SMALL_BUFFER), and both rows still say what they need.
			expect(modelBlock(small, DEVICES.binds128, on)).to.deep.equal({
				kind: "buffer",
				needed: small.largestBufferBytes,
				limit: 128 * MiB,
			});
			expect(modelBlock(large, DEVICES.binds128, on)).to.deep.equal({
				kind: "buffer",
				needed: large.largestBufferBytes,
				limit: 128 * MiB,
			});
			// 160 MiB: the 1.7B fits, the 4B does not.
			expect(modelBlock(small, DEVICES.binds160, on)).to.equal(null);
			expect(modelBlock(large, DEVICES.binds160, on)).to.deep.equal({
				kind: "buffer",
				needed: large.largestBufferBytes,
				limit: 160 * MiB,
			});
		});

		it("holds a deploy model of unknown size to the gpu tier's floor", () => {
			const deploy = buildCatalog({llm: {model: "Custom-q4f16_1-MLC"}}).llm;

			expect(modelBlock(deploy, DEVICES.binds160, on)).to.equal(null);
			expect(modelBlock(deploy, DEVICES.binds128, on)).to.deep.equal({
				kind: "buffer",
				needed: LLM_MIN_BUFFER_BYTES,
				limit: 128 * MiB,
			});
		});

		it("says switched off only for a model the device could run", () => {
			const off = {llm: false, cpu: false, nllb: true};

			expect(modelBlock(small, DEVICES.desktop, off)).to.deep.equal({
				kind: "off",
				engine: "llm",
			});
			expect(modelBlock(nllb, DEVICES.desktop, off)).to.deep.equal({
				kind: "off",
				engine: "seq2seq",
			});
			// Turning the switch on would change nothing: the device is the reason.
			expect(modelBlock(small, DEVICES.noWebgpu, off).kind).to.equal("device");
			expect(modelBlock(large, DEVICES.binds160, off).kind).to.equal("buffer");
			expect(modelBlock(nllb, DEVICES.noSimd, off)).to.deep.equal({
				kind: "device",
				reason: "NO_WASM_SIMD",
			});
		});

		it("blocks the CPU models without WebAssembly SIMD even on a gpu-tier device", () => {
			const gpuNoSimd = cap({reasons: ["NO_WASM_SIMD"]});

			expect(modelBlock(nllb, gpuNoSimd, on)).to.deep.equal({
				kind: "device",
				reason: "NO_WASM_SIMD",
			});
			expect(modelBlock(small, gpuNoSimd, on)).to.equal(null);
		});
	});

	describe("explainRoute", () => {
		const catalogFor = (capability: Capability) => selectLlm(base, null, capability);
		const ask = (
			capability: Capability,
			switches: EngineSwitches,
			from: string | null,
			to: string,
			sourceLater = false
		) =>
			explainRoute(
				table,
				catalogFor(capability),
				routeInput(capability, switches, {from, to, sourceLater})
			);

		it("agrees with resolveRoute everywhere, and gives a reason exactly when there is no route", () => {
			const switchSets: EngineSwitches[] = [
				{llm: true, cpu: true, nllb: true},
				{llm: true, cpu: false, nllb: true},
				{llm: false, cpu: true, nllb: true},
				{llm: false, cpu: false, nllb: true},
				// NLLB-200 off (the default): the OPUS pairs and the LLM only.
				{llm: true, cpu: true, nllb: false},
				{llm: false, cpu: true, nllb: false},
				{llm: true, cpu: false, nllb: false},
			];
			const pairs: [string | null, string][] = [
				["de", "en"],
				["fr", "en"],
				["en", "en"],
				["en", "fil"],
				[null, "en"],
				[null, "fil"],
			];

			for (const [name, capability] of Object.entries(DEVICES)) {
				for (const switches of switchSets) {
					for (const [from, to] of pairs) {
						for (const sourceLater of [false, true]) {
							const input = routeInput(capability, switches, {from, to, sourceLater});
							const catalog = catalogFor(capability);
							const verdict = explainRoute(table, catalog, input);
							const label = `${name} ${JSON.stringify(
								switches
							)} ${from}->${to} ${sourceLater}`;

							expect(verdict.route, label).to.deep.equal(
								resolveRoute(table, catalog, input)
							);
							expect(verdict.why === null, label).to.equal(verdict.route !== null);
							expect(verdict.polish, label).to.equal(from === to);

							// A switch named as the reason is a real fix: turned on,
							// the pair routes or a different reason takes over.
							if (verdict.why?.kind === "off" && verdict.why.engine !== "all") {
								const fixed =
									verdict.why.engine === "llm"
										? {...switches, llm: true}
										: verdict.why.engine === "nllb"
										? {...switches, nllb: true}
										: {...switches, cpu: true};
								const after = explainRoute(
									table,
									catalog,
									routeInput(capability, fixed, {from, to, sourceLater})
								);

								// Or it names the other switch the pair also needs (the CPU
								// models and NLLB-200 both off: NLLB needs both on).
								expect(
									after.route !== null ||
										after.why?.kind !== "off" ||
										after.why.engine !== verdict.why.engine,
									`${label} fixed`
								).to.equal(true);
							}
						}
					}
				}
			}
		});

		it("explains the cleanup pass by the GPU model's own block", () => {
			const binds128 = ask(DEVICES.binds128, on, "en", "en");

			expect(binds128.route).to.equal(null);
			expect(binds128.polish).to.equal(true);
			expect(binds128.why).to.deep.equal({
				kind: "buffer",
				needed: small.largestBufferBytes,
				limit: 128 * MiB,
			});
			expect(ask(DEVICES.noF16, on, "en", "en").why).to.deep.equal({
				kind: "device",
				reason: "NO_F16",
			});
			expect(ask(DEVICES.noWebgpu, on, "en", "en").why).to.deep.equal({
				kind: "device",
				reason: "NO_WEBGPU",
			});
			expect(
				ask(DEVICES.desktop, {llm: false, cpu: true, nllb: true}, "en", "en").why
			).to.deep.equal({
				kind: "off",
				engine: "llm",
			});
			// 160 MiB runs the 1.7B: the cleanup pass is on offer.
			expect(ask(DEVICES.binds160, on, "en", "en").route?.ref.id).to.equal(QWEN3_1_7B_ID);
		});

		it("names the switch the user can turn on over a device the GPU model cannot use", () => {
			// CPU-only device, CPU models off: the LLM cannot run here anyway,
			// so the fix is the CPU switch.
			expect(
				ask(DEVICES.noWebgpu, {llm: true, cpu: false, nllb: true}, "de", "en").why
			).to.deep.equal({
				kind: "off",
				engine: "seq2seq",
			});
		});

		it("names both switches when either would serve the pair", () => {
			expect(
				ask(DEVICES.desktop, {llm: false, cpu: false, nllb: true}, "de", "en").why
			).to.deep.equal({
				kind: "off",
				engine: "all",
			});
			// Only the LLM serves Filipino: its switch alone is named.
			expect(
				ask(DEVICES.desktop, {llm: false, cpu: false, nllb: true}, "en", "fil").why
			).to.deep.equal({
				kind: "off",
				engine: "llm",
			});
		});

		it("explains an LLM-only pair on a device without the GPU model by the device", () => {
			expect(ask(DEVICES.binds128, on, "en", "fil").why).to.deep.equal({
				kind: "buffer",
				needed: small.largestBufferBytes,
				limit: 128 * MiB,
			});
			expect(ask(DEVICES.desktop, on, "en", "fil").route?.candidate).to.equal("llm");
		});

		it("counts the CPU models for a line the detector will place, and only then", () => {
			expect(ask(DEVICES.noWebgpu, on, null, "en", true).route?.candidate).to.equal("nllb");
			// A request with no source at all: only the LLM takes one, and it is
			// the device that keeps it out, so that is what is said.
			expect(ask(DEVICES.noWebgpu, on, null, "en", false).why).to.deep.equal({
				kind: "device",
				reason: "NO_WEBGPU",
			});
			expect(
				ask(DEVICES.noWebgpu, {llm: false, cpu: true, nllb: true}, null, "en", false).why
			).to.deep.equal({kind: "device", reason: "NO_WEBGPU"});
		});

		describe("NLLB-200 switched off (the default; its licence is non-commercial)", () => {
			const noNllb: EngineSwitches = {llm: true, cpu: true, nllb: false};
			// The shipped table: the OPUS pairs ahead of NLLB everywhere.
			const shipped = routesFor(QWEN3_1_7B_ID);
			const askShipped = (capability: Capability, from: string | null, to: string) =>
				explainRoute(
					shipped,
					catalogFor(capability),
					routeInput(capability, noNllb, {from, to})
				);

			it("blocks the NLLB row as switched off, and only that one", () => {
				expect(modelBlock(nllb, DEVICES.desktop, noNllb)).to.deep.equal({
					kind: "off",
					engine: "nllb",
				});
				expect(modelBlock(base.opus["de-en"], DEVICES.desktop, noNllb)).to.equal(null);
				expect(modelBlock(small, DEVICES.desktop, noNllb)).to.equal(null);
			});

			it("gives a pair only NLLB serves here the NLLB reason", () => {
				// No WebGPU, English to Filipino: no OPUS pair, the LLM cannot run.
				expect(askShipped(DEVICES.noWebgpu, "en", "fil").why).to.deep.equal({
					kind: "off",
					engine: "nllb",
				});
				// And it is a real fix: switched on, NLLB takes it.
				expect(
					explainRoute(
						shipped,
						catalogFor(DEVICES.noWebgpu),
						routeInput(
							DEVICES.noWebgpu,
							{...noNllb, nllb: true},
							{from: "en", to: "fil"}
						)
					).route?.candidate
				).to.equal("nllb");
			});

			it("sends an NLLB-first pair to the GPU model where it runs", () => {
				// Serbian is NLLB-first for 1.7B (routes.default.ts).
				expect(askShipped(DEVICES.desktop, "en", "sr").route?.candidate).to.equal("llm");
			});

			it("still translates the OPUS-MT pairs on a device without WebGPU", () => {
				for (const pair of Object.keys(base.opus)) {
					const [from, to] = pair.split("-");

					expect(askShipped(DEVICES.noWebgpu, from, to).route?.candidate, pair).to.equal(
						`opus:${pair}`
					);
				}
			});

			it("never makes translation as a whole unavailable", () => {
				expect(translationBlock(base, DEVICES.noWebgpu, noNllb)).to.equal(null);
				expect(translationBlock(base, DEVICES.desktop, noNllb)).to.equal(null);
			});
		});

		it("explains a device that runs nothing by the CPU models' code", () => {
			expect(ask(DEVICES.noSimd, on, "de", "en").why).to.deep.equal({
				kind: "device",
				reason: "NO_WASM_SIMD",
			});
			expect(ask(DEVICES.probeFailed, on, "de", "en").why).to.deep.equal({
				kind: "device",
				reason: "PROBE_FAILED",
			});
		});

		it("skips the CPU models on a gpu-tier device without WebAssembly SIMD", () => {
			const gpuNoSimd = cap({reasons: ["NO_WASM_SIMD"]});
			const cpuOnly: RouteTable = {"*": {"*": ["nllb"]}};
			const verdict = explainRoute(
				cpuOnly,
				base,
				routeInput(gpuNoSimd, on, {from: "de", to: "en"})
			);

			expect(verdict.route).to.equal(null);
			expect(verdict.why).to.deep.equal({kind: "device", reason: "NO_WASM_SIMD"});
		});

		it("reports a candidate down for the session once nothing else serves", () => {
			const verdict = explainRoute(
				table,
				base,
				routeInput(DEVICES.desktop, on, {from: "en", to: "fil"}, new Set(["llm"]))
			);

			expect(verdict.why).to.deep.equal({kind: "down"});
		});

		it("reads the tier and WebAssembly SIMD off the probe; an unknown probe routes nothing", () => {
			const input = routeInput(DEVICES.noSimd, on, {from: "de", to: "en"});

			expect(input.tier).to.equal("none");
			expect(input.wasm).to.equal(false);
			expect(routeInput(null, on, {from: "de", to: "en"}).tier).to.equal("none");
		});
	});

	describe("translationBlock", () => {
		const block = (capability: Capability | null, switches: EngineSwitches, enabled = true) =>
			translationBlock(selectLlm(base, null, capability), capability, switches, enabled);

		it("is null while either engine runs", () => {
			expect(block(DEVICES.desktop, on)).to.equal(null);
			expect(block(DEVICES.desktop, {llm: false, cpu: true, nllb: true})).to.equal(null);
			expect(block(DEVICES.desktop, {llm: true, cpu: false, nllb: true})).to.equal(null);
			expect(block(DEVICES.noWebgpu, {llm: true, cpu: true, nllb: true})).to.equal(null);
		});

		it("says both switches are off as one reason", () => {
			expect(block(DEVICES.desktop, {llm: false, cpu: false, nllb: true})).to.deep.equal({
				kind: "off",
				engine: "all",
			});
		});

		it("names the switch that would fix it on a device without the GPU model", () => {
			expect(block(DEVICES.noWebgpu, {llm: true, cpu: false, nllb: true})).to.deep.equal({
				kind: "off",
				engine: "seq2seq",
			});
			expect(block(DEVICES.binds128, {llm: false, cpu: false, nllb: true})).to.deep.equal({
				kind: "off",
				engine: "seq2seq",
			});
		});

		it("names the device when nothing could run however the switches stand", () => {
			expect(block(DEVICES.noSimd, on)).to.deep.equal({
				kind: "device",
				reason: "NO_WASM_SIMD",
			});
			expect(block(null, on)).to.deep.equal({kind: "probing"});
			expect(block(DEVICES.desktop, on, false)).to.deep.equal({kind: "disabled"});
		});
	});
});
