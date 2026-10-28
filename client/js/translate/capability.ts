// The device probe (spec § capability.ts): what the router may pick from.
// `gpu` needs a WebGPU adapter with 16-bit float shaders and a storage
// binding as large as the smallest GPU model's largest tensor
// (models.ts `LLM_MIN_BUFFER_BYTES`; which models fit is `llmFits`); `cpu` needs
// WebAssembly SIMD for ONNX Runtime; `none` hides the feature. The reasons
// are what Settings shows in place of a missing model row. `browserEnv()`
// is the only place that reads `navigator`; tests pass their own env.

import {LLM_MIN_BUFFER_BYTES} from "./models";

export type Tier = "gpu" | "cpu" | "none";

/**
 * Why the GPU tier (or translation itself) is out of reach, as a code:
 * this module is Vue-free and never imports the i18n runtime, so Settings
 * renders each code through its own `translate.capability.reason.*` key.
 */
export type CapabilityReason =
	| "NO_WEBGPU"
	| "INSECURE_ORIGIN"
	| "NO_ADAPTER"
	| "NO_F16"
	| "SMALL_BUFFER"
	| "NO_WASM_SIMD"
	/** The probe itself threw: nothing could be measured (service.ts). */
	| "PROBE_FAILED";

export interface Capability {
	tier: Tier;
	reasons: CapabilityReason[];
	f16: boolean;
	maxBufferBytes: number;
	deviceMemoryGiB: number | null;
	storageQuotaBytes: number | null;
	/** A phone or tablet: models.ts never defaults one to the large GPU model. */
	mobile: boolean;
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
	/**
	 * Whether the page is a secure context (`window.isSecureContext`), when
	 * that is known. A plain-HTTP origin away from localhost is the usual
	 * reason `navigator.gpu` is missing entirely, and the one a reader can
	 * do something about — the probe names it instead of a bare "no
	 * WebGPU". Undefined where the question makes no sense (tests).
	 */
	secureContext?: boolean;
	/** A phone or tablet (`browserEnv`); absent means a computer. */
	mobile?: boolean;
}

// A model binds each weight tensor whole, so the floor is the smallest GPU
// model's largest tensor (148 MiB for Qwen3 1.7B), not WebLLM's 1 GiB: the
// worker asks WebLLM's device for whatever the adapter offers
// (engines/gpuLimits.ts), and a phone offering 256 MiB-1 GiB can load it.
export const GPU_MIN_BUFFER_BYTES = LLM_MIN_BUFFER_BYTES;

/** A minimal module using a v128 op; validating it proves SIMD support. */
export const WASM_SIMD_PROBE = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253,
	15, 253, 98, 11,
]);

export async function probe(env: ProbeEnv): Promise<Capability> {
	const reasons: CapabilityReason[] = [];
	let f16 = false;
	let maxBufferBytes = 0;
	let gpuOk = false;

	if (!env.gpu) {
		reasons.push(env.secureContext === false ? "INSECURE_ORIGIN" : "NO_WEBGPU");
	} else {
		let adapter: AdapterLike | null = null;

		try {
			adapter = await env.gpu.requestAdapter();
		} catch {
			adapter = null;
		}

		if (!adapter) {
			reasons.push("NO_ADAPTER");
		} else {
			f16 = adapter.features.has("shader-f16");
			maxBufferBytes = Math.min(
				adapter.limits.maxBufferSize,
				adapter.limits.maxStorageBufferBindingSize
			);

			if (!f16) {
				reasons.push("NO_F16");
			} else if (maxBufferBytes < GPU_MIN_BUFFER_BYTES) {
				reasons.push("SMALL_BUFFER");
			} else {
				gpuOk = true;
			}
		}
	}

	if (!env.wasmSimd) {
		reasons.push("NO_WASM_SIMD");
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
		mobile: env.mobile === true,
	};
}

export function browserEnv(): ProbeEnv {
	const nav = navigator as Navigator & {
		gpu?: {requestAdapter(): Promise<AdapterLike | null>};
		deviceMemory?: number;
		userAgentData?: {mobile?: boolean};
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
		secureContext: typeof window !== "undefined" ? window.isSecureContext : undefined,
		mobile: isMobile(nav),
	};
}

/**
 * A phone or tablet: Chromium says so outright (`userAgentData.mobile`); the
 * others by their user agent, and an iPad that asks for desktop sites by a
 * Mac with a touch screen.
 */
function isMobile(nav: Navigator & {userAgentData?: {mobile?: boolean}}): boolean {
	if (typeof nav.userAgentData?.mobile === "boolean" && nav.userAgentData.mobile) {
		return true;
	}

	const ua = nav.userAgent ?? "";

	return (
		/Android|iPhone|iPad|iPod|Mobi/i.test(ua) ||
		(/Macintosh/.test(ua) && nav.maxTouchPoints > 1)
	);
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
