import {expect} from "chai";
import {
	GPU_MIN_BUFFER_BYTES,
	probe,
	probeOnce,
	resetProbe,
	type AdapterLike,
	type ProbeEnv,
} from "../../client/js/translate/capability";

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

	it("is cpu without WebGPU and says why", async () => {
		const cap = await probe(env({gpu: null}));

		expect(cap.tier).to.equal("cpu");
		expect(cap.reasons).to.deep.equal(["no WebGPU"]);
	});

	it("is cpu when the adapter is missing, has no f16 or too small a buffer", async () => {
		expect(
			(await probe(env({gpu: {requestAdapter: () => Promise.resolve(null)}}))).reasons
		).to.deep.equal(["WebGPU adapter unavailable"]);
		expect(
			(
				await probe(
					env({gpu: {requestAdapter: () => Promise.resolve(adapter({f16: false}))}})
				)
			).reasons
		).to.deep.equal(["no 16-bit float shaders"]);
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
		).to.deep.equal(["GPU buffer limit under 2 GiB"]);
	});

	it("is none without WebAssembly SIMD, with every reason listed", async () => {
		const cap = await probe(env({gpu: null, wasmSimd: false}));

		expect(cap.tier).to.equal("none");
		expect(cap.reasons).to.deep.equal(["no WebGPU", "no WebAssembly SIMD"]);
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
		expect(cap.reasons).to.deep.equal(["WebGPU adapter unavailable"]);
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
