import {expect} from "chai";
import {
	GPU_MIN_BUFFER_BYTES,
	probe,
	probeOnce,
	resetProbe,
	type AdapterLike,
	type ProbeEnv,
} from "../../client/js/translate/capability";
import {buildCatalog, modelBlock} from "../../client/js/translate/models";

function adapter(overrides: Partial<{f16: boolean; maxBuffer: number}> = {}): AdapterLike {
	const f16 = overrides.f16 ?? true;
	const maxBuffer = overrides.maxBuffer ?? 4 * 1024 * 1024 * 1024;

	return {
		features: {has: (name: string) => name === "shader-f16" && f16},
		limits: {maxBufferSize: maxBuffer, maxStorageBufferBindingSize: maxBuffer},
	};
}

function env(overrides: Partial<ProbeEnv> = {}): ProbeEnv {
	return {
		gpu: {requestAdapter: () => Promise.resolve(adapter())},
		deviceMemory: 8,
		storage: {estimate: () => Promise.resolve({quota: 50 * 1024 * 1024 * 1024})},
		wasmSimd: true,
		...overrides,
	};
}

describe("translate/capability", () => {
	afterEach(() => resetProbe());

	it("rates a capable device gpu with no reasons", async () => {
		const cap = await probe(env());

		expect(cap.tier).to.equal("gpu");
		expect(cap.reasons).to.deep.equal([]);
		expect(cap.f16).to.equal(true);
		expect(cap.deviceMemoryGiB).to.equal(8);
		expect(cap.storageQuotaBytes).to.equal(50 * 1024 * 1024 * 1024);
	});

	it("is cpu without WebGPU and reports the code why", async () => {
		const cap = await probe(env({gpu: null}));

		expect(cap.tier).to.equal("cpu");
		expect(cap.reasons).to.deep.equal(["NO_WEBGPU"]);
	});

	it("names the insecure origin as the reason there is no WebGPU", async () => {
		// Plain HTTP away from localhost: isSecureContext is false and
		// navigator.gpu does not exist at all. The reason says what to do
		// about it, not just that the API is missing.
		const cap = await probe(env({gpu: null, secureContext: false}));

		expect(cap.tier).to.equal("cpu");
		expect(cap.reasons).to.deep.equal(["INSECURE_ORIGIN"]);
	});

	it("a secure context without WebGPU still says plain no WebGPU", async () => {
		expect((await probe(env({gpu: null, secureContext: true}))).reasons).to.deep.equal([
			"NO_WEBGPU",
		]);
		// Unknown (tests, odd embeddings) behaves as today.
		expect((await probe(env({gpu: null, secureContext: undefined}))).reasons).to.deep.equal([
			"NO_WEBGPU",
		]);
	});

	it("is cpu when the adapter is missing, has no f16 or too small a buffer", async () => {
		expect(
			(await probe(env({gpu: {requestAdapter: () => Promise.resolve(null)}}))).reasons
		).to.deep.equal(["NO_ADAPTER"]);
		expect(
			(
				await probe(
					env({gpu: {requestAdapter: () => Promise.resolve(adapter({f16: false}))}})
				)
			).reasons
		).to.deep.equal(["NO_F16"]);
		expect(
			(
				await probe(
					env({
						gpu: {
							requestAdapter: () =>
								Promise.resolve(adapter({maxBuffer: GPU_MIN_BUFFER_BYTES - 1})),
						},
					})
				)
			).reasons
		).to.deep.equal(["SMALL_BUFFER"]);
	});

	// WebLLM's detectGPUDevice refuses an adapter below these two before it
	// asks for a device, however large its buffers: the probe has to say
	// so, or Settings promises a model that can never load.
	it("is cpu below WebLLM's shader limits, and a limit the adapter does not report passes", async () => {
		const withLimits = (limits: Partial<AdapterLike["limits"]>) =>
			probe(
				env({
					gpu: {
						requestAdapter() {
							const a = adapter();

							return Promise.resolve({...a, limits: {...a.limits, ...limits}});
						},
					},
				})
			);

		for (const limits of [
			{maxStorageBuffersPerShaderStage: 8},
			{maxComputeWorkgroupStorageSize: 16384},
		]) {
			const cap = await withLimits(limits);

			expect(cap.tier).to.equal("cpu");
			expect(cap.reasons).to.deep.equal(["GPU_LIMITS"]);
			expect(
				modelBlock(buildCatalog().llm, cap, {llm: true, cpu: true, nllb: true})
			).to.deep.equal({
				kind: "device",
				reason: "GPU_LIMITS",
			});
		}

		const enough = await withLimits({
			maxStorageBuffersPerShaderStage: 10,
			maxComputeWorkgroupStorageSize: 32768,
		});

		expect(enough.tier).to.equal("gpu");
		expect(enough.reasons).to.deep.equal([]);
	});

	it("rates gpu a phone's GPU that binds the 1.7B's small-buffer build, not WebLLM's 1 GiB", async () => {
		const MiB = 1024 * 1024;
		const at = (maxBuffer: number) =>
			probe(env({gpu: {requestAdapter: () => Promise.resolve(adapter({maxBuffer}))}}));

		// Most Android phones (Mali) and a fifth of iPhones offer 256-768 MiB.
		const phone = await at(512 * MiB);
		expect(phone.tier).to.equal("gpu");
		expect(phone.maxBufferBytes).to.equal(512 * MiB);
		// Adreno 7xx offers WebGPU's floor alone: the 1.7B's embedding does
		// not fit it, its small-buffer build (74 MiB at most) does.
		const floor = await at(128 * MiB);
		expect(floor.tier).to.equal("gpu");
		expect(floor.reasons).to.deep.equal([]);
		expect(floor.maxBufferBytes, "the limit is reported for Settings").to.equal(128 * MiB);
		// Below even that (no WebGPU device is): no GPU model fits.
		const below = await at(64 * MiB);
		expect(below.tier).to.equal("cpu");
		expect(below.reasons).to.deep.equal(["SMALL_BUFFER"]);
	});

	it("holds the limit to the test switch's cap, and says so", async () => {
		const MiB = 1024 * 1024;
		const at = (maxBuffer: number, bufferCapBytes?: number | null) =>
			probe(
				env({
					gpu: {requestAdapter: () => Promise.resolve(adapter({maxBuffer}))},
					bufferCapBytes,
				})
			);

		const capped = await at(2048 * MiB, 128 * MiB);
		expect(capped.maxBufferBytes).to.equal(128 * MiB);
		expect(capped.bufferCapBytes).to.equal(128 * MiB);
		expect(capped.tier).to.equal("gpu");
		// A cap above what the GPU binds changes nothing but the note.
		const above = await at(256 * MiB, 1024 * MiB);
		expect(above.maxBufferBytes).to.equal(256 * MiB);
		// No switch, no cap.
		const plain = await at(256 * MiB);
		expect(plain.maxBufferBytes).to.equal(256 * MiB);
		expect(plain.bufferCapBytes).to.equal(null);
	});

	it("passes a phone's mobile flag on, a computer by default", async () => {
		expect((await probe(env())).mobile).to.equal(false);
		expect((await probe(env({mobile: true}))).mobile).to.equal(true);
	});

	it("rates gpu an adapter whose binding limit is 2 GiB minus the alignment slack", async () => {
		// Chrome reports maxStorageBufferBindingSize as 2147483644 on most desktop GPUs.
		const cap = await probe(
			env({gpu: {requestAdapter: () => Promise.resolve(adapter({maxBuffer: 2147483644}))}})
		);

		expect(cap.tier).to.equal("gpu");
		expect(cap.reasons).to.deep.equal([]);
	});

	it("is none without WebAssembly SIMD, with every reason listed", async () => {
		const cap = await probe(env({gpu: null, wasmSimd: false}));

		expect(cap.tier).to.equal("none");
		expect(cap.reasons).to.deep.equal(["NO_WEBGPU", "NO_WASM_SIMD"]);
	});

	it("survives a throwing adapter request and missing optional APIs", async () => {
		const cap = await probe(
			env({
				gpu: {
					requestAdapter() {
						throw new Error("boom");
					},
				},
				deviceMemory: null,
				storage: null,
			})
		);

		expect(cap.tier).to.equal("cpu");
		expect(cap.reasons).to.deep.equal(["NO_ADAPTER"]);
		expect(cap.deviceMemoryGiB).to.equal(null);
		expect(cap.storageQuotaBytes).to.equal(null);
	});

	it("probeOnce runs the probe a single time per page", async () => {
		let calls = 0;
		const e = env({
			gpu: {
				requestAdapter() {
					calls++;
					return Promise.resolve(adapter());
				},
			},
		});

		await probeOnce(e);
		await probeOnce(e);
		expect(calls).to.equal(1);
	});
});
