import {expect} from "chai";
import {
	installBufferLimits,
	raiseBufferLimits,
	WEBLLM_FULL_REQUEST,
} from "../../client/js/translate/engines/gpuLimits";

const MiB = 1024 * 1024;

/** What WebLLM 0.2.85's detectGPUDevice asks an adapter under 1 GiB for. */
const webllmFallback = () => ({
	requiredLimits: {
		maxBufferSize: 256 * MiB,
		maxStorageBufferBindingSize: 128 * MiB,
		maxComputeWorkgroupStorageSize: 32 * 1024,
	},
	requiredFeatures: ["shader-f16"],
});

describe("gpuLimits", () => {
	describe("raiseBufferLimits", () => {
		it("asks a phone for what it offers instead of WebGPU's floor", () => {
			const raised = raiseBufferLimits(webllmFallback(), {
				maxBufferSize: 512 * MiB,
				maxStorageBufferBindingSize: 512 * MiB,
			});
			expect(raised?.requiredLimits).to.deep.equal({
				maxBufferSize: 512 * MiB,
				maxStorageBufferBindingSize: 512 * MiB,
				maxComputeWorkgroupStorageSize: 32 * 1024,
			});
			expect(raised?.requiredFeatures).to.deep.equal(["shader-f16"]);
		});

		it("never asks for more than WebLLM's own 1 GiB, so a desktop is unchanged", () => {
			const request = {
				requiredLimits: {
					maxBufferSize: WEBLLM_FULL_REQUEST,
					maxStorageBufferBindingSize: WEBLLM_FULL_REQUEST,
				},
			};
			const offered = {maxBufferSize: 4096 * MiB, maxStorageBufferBindingSize: 2047 * MiB};
			expect(raiseBufferLimits(request, offered)).to.equal(request);
		});

		it("caps a raise at 1 GiB, and a binding at the buffer it binds", () => {
			const raised = raiseBufferLimits(webllmFallback(), {
				maxBufferSize: 768 * MiB,
				maxStorageBufferBindingSize: 2048 * MiB,
			});
			expect(raised?.requiredLimits?.maxBufferSize).to.equal(768 * MiB);
			expect(raised?.requiredLimits?.maxStorageBufferBindingSize).to.equal(768 * MiB);
		});

		it("leaves an adapter at the floor and a request without limits alone", () => {
			const request = webllmFallback();
			expect(
				raiseBufferLimits(request, {
					maxBufferSize: 256 * MiB,
					maxStorageBufferBindingSize: 128 * MiB,
				})
			).to.equal(request);
			expect(raiseBufferLimits({}, {maxBufferSize: 1})).to.deep.equal({});
			expect(raiseBufferLimits(undefined, {maxBufferSize: 1})).to.equal(undefined);
		});
	});

	describe("installBufferLimits", () => {
		/** A stand-in for GPUAdapter.prototype that records every request. */
		function fakeAdapterClass(refuseAbove = Infinity) {
			const seen: unknown[] = [];

			class FakeAdapter {
				limits: Record<string, number>;

				constructor(limits: Record<string, number>) {
					this.limits = limits;
				}

				requestDevice(request?: {requiredLimits?: Record<string, number>}) {
					seen.push(request);
					const binding = request?.requiredLimits?.maxStorageBufferBindingSize ?? 0;

					return binding > refuseAbove
						? Promise.reject(new Error("OperationError"))
						: Promise.resolve({request});
				}
			}

			return {FakeAdapter, seen};
		}

		it("makes WebLLM's request go through the raise", async () => {
			const {FakeAdapter, seen} = fakeAdapterClass();
			expect(installBufferLimits(FakeAdapter.prototype)).to.equal(true);
			expect(installBufferLimits(FakeAdapter.prototype), "idempotent").to.equal(true);
			const adapter = new FakeAdapter({
				maxBufferSize: 512 * MiB,
				maxStorageBufferBindingSize: 512 * MiB,
			});
			await adapter.requestDevice(webllmFallback());
			expect(seen).to.have.length(1);
			expect(
				(seen[0] as {requiredLimits: Record<string, number>}).requiredLimits
					.maxStorageBufferBindingSize
			).to.equal(512 * MiB);
		});

		it("falls back to the original request when the raised one is refused", async () => {
			const {FakeAdapter, seen} = fakeAdapterClass(128 * MiB);
			installBufferLimits(FakeAdapter.prototype);
			const adapter = new FakeAdapter({
				maxBufferSize: 512 * MiB,
				maxStorageBufferBindingSize: 512 * MiB,
			});
			const device = (await adapter.requestDevice(webllmFallback())) as {
				request: {requiredLimits: Record<string, number>};
			};
			expect(seen).to.have.length(2);
			expect(device.request.requiredLimits.maxStorageBufferBindingSize).to.equal(128 * MiB);
		});

		it("does nothing without WebGPU", () => {
			expect(installBufferLimits(undefined)).to.equal(false);
			expect(installBufferLimits(null)).to.equal(false);
		});
	});
});
