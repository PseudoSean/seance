// One engine slot that can run on either device (spec
// docs/projects/translation-devices.md § Engines and the worker): it holds
// an engine per device and keeps one device's models in memory at a time.
// Loading on the other device unloads this one's first, after the requests
// already running on it have finished. Vue-free and library-free: the
// engines arrive through the constructor.

import {
	Device,
	Engine,
	EngineCapabilities,
	EngineName,
	EngineStatus,
	LoadProgress,
	ModelRef,
	TranslateChunk,
	TranslateRequest,
} from "../engine";

export class OnDevice implements Engine {
	readonly name: EngineName;
	private engines: Record<Device, Engine>;
	private active: Device = "gpu";
	/** The requests streaming on each device, settled when their stream ends. */
	private running: Record<Device, Set<Promise<void>>> = {gpu: new Set(), cpu: new Set()};

	constructor(name: EngineName, engines: Record<Device, Engine>) {
		this.name = name;
		this.engines = engines;
	}

	async load(
		ref: ModelRef,
		device: Device,
		onProgress: (p: LoadProgress) => void
	): Promise<void> {
		const other: Device = device === "gpu" ? "cpu" : "gpu";

		if (this.engines[other].loadedModels().length > 0) {
			// The running request finishes on its device first.
			while (this.running[other].size > 0) {
				await Promise.allSettled([...this.running[other]]);
			}

			await this.engines[other].unload();
		}

		this.active = device;
		await this.engines[device].load(ref, device, onProgress);
	}

	async unload(): Promise<void> {
		await Promise.all([this.engines.gpu.unload(), this.engines.cpu.unload()]);
	}

	status(): EngineStatus {
		return this.engines[this.active].status();
	}

	loadedModels(): string[] {
		return [...this.engines.gpu.loadedModels(), ...this.engines.cpu.loadedModels()];
	}

	isLoaded(id: string, device?: Device): boolean {
		return device === undefined
			? this.engines.gpu.isLoaded(id) || this.engines.cpu.isLoaded(id)
			: this.engines[device].isLoaded(id);
	}

	capabilities(): EngineCapabilities {
		return this.engines[this.active].capabilities();
	}

	async *translate(req: TranslateRequest, signal: AbortSignal): AsyncIterable<TranslateChunk> {
		const device = req.device ?? this.deviceOf(req.model);

		let finish: () => void = () => {};

		const settled = new Promise<void>((resolve) => {
			finish = resolve;
		});

		this.running[device].add(settled);

		try {
			yield* this.engines[device].translate(req, signal);
		} finally {
			this.running[device].delete(settled);
			finish();
		}
	}

	/** The device `id` is loaded on, else the active one. */
	private deviceOf(id: string): Device {
		if (this.engines[this.active].isLoaded(id)) {
			return this.active;
		}

		return this.engines[this.active === "gpu" ? "cpu" : "gpu"].isLoaded(id)
			? this.active === "gpu"
				? "cpu"
				: "gpu"
			: this.active;
	}
}
