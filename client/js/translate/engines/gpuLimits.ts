// WebLLM asks the GPU for its buffers in two sizes only: 1 GiB, or, when the
// adapter cannot give that, WebGPU's 128 MiB floor for a storage binding
// (256 MiB for a buffer) — nothing in between (@mlc-ai/web-llm 0.2.85,
// `detectGPUDevice`). Most phones offer something in between, and a model
// binds each weight tensor whole: Qwen3 1.7B's embedding is one 148 MiB
// tensor, so on a phone that offers 512 MiB WebLLM asked for 128 MiB and the
// model could not load. This raises what WebLLM's `requestDevice` asks for to
// what the adapter offers, never above the 1 GiB WebLLM itself would ask a
// larger adapter for, so a desktop's device is unchanged. The worker installs
// it before WebLLM runs (webllm.real.ts); Vue-free and DOM-free, so mocha
// tests it with a stand-in prototype.

/** What WebLLM asks for from an adapter that can give it. */
export const WEBLLM_FULL_REQUEST = 1024 * 1024 * 1024;

type Limits = Record<string, number | undefined>;

export interface DeviceRequest {
	requiredLimits?: Limits;
	[key: string]: unknown;
}

const RAISED = ["maxBufferSize", "maxStorageBufferBindingSize"] as const;

/**
 * `request` with its buffer limits raised to what `adapterLimits` offers (at
 * most 1 GiB), or `request` itself when nothing would change. A binding is
 * never asked larger than the buffer it binds.
 */
export function raiseBufferLimits(
	request: DeviceRequest | undefined,
	adapterLimits: Limits
): DeviceRequest | undefined {
	const asked = request?.requiredLimits;

	if (!request || !asked) {
		return request;
	}

	const limits: Limits = {...asked};
	let changed = false;

	for (const name of RAISED) {
		const wanted = asked[name];
		const offered = adapterLimits[name];

		if (typeof wanted !== "number" || typeof offered !== "number") {
			continue;
		}

		const target = Math.min(offered, WEBLLM_FULL_REQUEST);

		if (target > wanted) {
			limits[name] = target;
			changed = true;
		}
	}

	if (!changed) {
		return request;
	}

	const buffer = limits.maxBufferSize;
	const binding = limits.maxStorageBufferBindingSize;

	if (typeof buffer === "number" && typeof binding === "number" && binding > buffer) {
		limits.maxStorageBufferBindingSize = buffer;
	}

	return {...request, requiredLimits: limits};
}

interface AdapterPrototype {
	// A property, not a method: it is taken off the prototype unbound and
	// called with each adapter as `this`.
	requestDevice: (this: {limits: Limits}, request?: DeviceRequest) => Promise<unknown>;
}

const INSTALLED = Symbol.for("seance.gpuLimits");

/**
 * Wraps `proto.requestDevice` (the worker's `GPUAdapter.prototype`) so a
 * request below what the adapter offers is raised; should the raised request
 * be refused, the original one is made, so a device that worked before still
 * does. Idempotent. Returns whether it installed (false without WebGPU).
 */
export function installBufferLimits(proto: AdapterPrototype | undefined | null): boolean {
	if (!proto || typeof proto.requestDevice !== "function") {
		return false;
	}

	const marked = proto as AdapterPrototype & {[INSTALLED]?: true};

	if (marked[INSTALLED]) {
		return true;
	}

	const original = proto.requestDevice;

	proto.requestDevice = async function (this: {limits: Limits}, request?: DeviceRequest) {
		const raised = raiseBufferLimits(request, this.limits);

		if (raised === request) {
			return original.call(this, request);
		}

		try {
			return await original.call(this, raised);
		} catch {
			return original.call(this, request);
		}
	};

	marked[INSTALLED] = true;

	return true;
}
