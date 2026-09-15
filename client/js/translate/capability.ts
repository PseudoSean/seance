// The device probe (spec § capability.ts): what the router may pick from.
// `gpu` needs a WebGPU adapter with 16-bit float shaders and 1 GiB of
// addressable buffer (a q4f16 1.7B model plus its KV cache); `cpu` needs
// WebAssembly SIMD for ONNX Runtime; `none` hides the feature. The reasons
// are what Settings shows in place of a missing model row. `browserEnv()`
// is the only place that reads `navigator`; tests pass their own env.

export type Tier = "gpu" | "cpu" | "none";

export interface Capability {
	tier: Tier;
	reasons: string[];
	f16: boolean;
	maxBufferBytes: number;
	deviceMemoryGiB: number | null;
	storageQuotaBytes: number | null;
}

export interface AdapterLike {
	features: {has(name: string): boolean};
	limits: {maxBufferSize: number; maxStorageBufferBindingSize: number};
}

export interface ProbeEnv {
	gpu: {requestAdapter(): Promise<AdapterLike | null>} | null;
	deviceMemory: number | null;
	storage: {estimate(): Promise<{quota?: number}>} | null;
	wasmSimd: boolean;
}

// WebLLM's own floor for a q4f16 model. Adapters report their limits with alignment
// slack (Chrome: maxStorageBufferBindingSize 2147483644 on most desktop GPUs), so a
// threshold at exactly 2 GiB refused hardware that runs the model fine.
export const GPU_MIN_BUFFER_BYTES = 1024 * 1024 * 1024;

/** A minimal module using a v128 op; validating it proves SIMD support. */
export const WASM_SIMD_PROBE = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253,
	15, 253, 98, 11,
]);

export async function probe(env: ProbeEnv): Promise<Capability> {
	const reasons: string[] = [];
	let f16 = false;
	let maxBufferBytes = 0;
	let gpuOk = false;

	if (!env.gpu) {
		reasons.push("no WebGPU");
	} else {
		let adapter: AdapterLike | null = null;

		try {
			adapter = await env.gpu.requestAdapter();
		} catch {
			adapter = null;
		}

		if (!adapter) {
			reasons.push("WebGPU adapter unavailable");
		} else {
			f16 = adapter.features.has("shader-f16");
			maxBufferBytes = Math.min(
				adapter.limits.maxBufferSize,
				adapter.limits.maxStorageBufferBindingSize
			);

			if (!f16) {
				reasons.push("no 16-bit float shaders");
			} else if (maxBufferBytes < GPU_MIN_BUFFER_BYTES) {
				reasons.push("GPU buffer limit under 1 GiB");
			} else {
				gpuOk = true;
			}
		}
	}

	if (!env.wasmSimd) {
		reasons.push("no WebAssembly SIMD");
	}

	let storageQuotaBytes: number | null = null;

	if (env.storage) {
		try {
			storageQuotaBytes = (await env.storage.estimate()).quota ?? null;
		} catch {
			storageQuotaBytes = null;
		}
	}

	const tier: Tier = gpuOk ? "gpu" : env.wasmSimd ? "cpu" : "none";

	return {
		tier,
		reasons,
		f16,
		maxBufferBytes,
		deviceMemoryGiB: env.deviceMemory,
		storageQuotaBytes,
	};
}

export function browserEnv(): ProbeEnv {
	const nav = navigator as Navigator & {
		gpu?: {requestAdapter(): Promise<AdapterLike | null>};
		deviceMemory?: number;
	};
	let wasmSimd = false;

	try {
		wasmSimd = WebAssembly.validate(WASM_SIMD_PROBE);
	} catch {
		wasmSimd = false;
	}

	return {
		gpu: nav.gpu ?? null,
		deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
		storage: nav.storage && typeof nav.storage.estimate === "function" ? nav.storage : null,
		wasmSimd,
	};
}

let cached: Promise<Capability> | null = null;

/** The probe runs once per page; the result is kept in memory only. */
export function probeOnce(env?: ProbeEnv): Promise<Capability> {
	if (!cached) {
		cached = probe(env ?? browserEnv());
	}

	return cached;
}

/** Tests only. */
export function resetProbe(): void {
	cached = null;
}
