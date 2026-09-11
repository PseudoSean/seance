// The messages between the page and translate-worker.js (spec § worker.ts).
// `Port` is the slice of `Worker` / `DedicatedWorkerGlobalScope` both sides
// use, so tests and the dev-only fake (fakePort.ts) can pass an in-process
// pair from `createPortPair()`.

import {
	EngineName,
	EngineStatus,
	LoadProgress,
	ModelRef,
	TranslateChunk,
	TranslateRequest,
} from "./engine";
import {ModelCacheState, ModelCatalog} from "./models";

export type MainToWorker =
	| {type: "configure"; catalog: ModelCatalog; ortBase: string}
	| {type: "load"; ref: ModelRef}
	| {type: "unload"; engine: EngineName}
	| {type: "translate"; req: TranslateRequest; ref: ModelRef}
	| {type: "cancel"; id: number}
	| {type: "status"}
	| {type: "models"}
	| {type: "delete"; ref: ModelRef};

export interface EngineSnapshot {
	status: EngineStatus;
	models: string[];
	threads?: boolean;
}

export type WorkerToMain =
	| {type: "progress"; ref: ModelRef; progress: LoadProgress}
	| {type: "loaded"; ref: ModelRef}
	| {type: "unloaded"; engine: EngineName}
	| {type: "chunk"; chunk: TranslateChunk}
	| {type: "done"; id: number}
	| {
			type: "error";
			scope: "load" | "translate" | "delete" | "worker";
			id?: number;
			ref?: ModelRef;
			message: string;
	  }
	| {type: "status"; engines: Record<EngineName, EngineSnapshot>}
	| {type: "models"; models: ModelCacheState[]}
	| {type: "deleted"; ref: ModelRef};

export interface Port<Out, In> {
	postMessage(message: Out): void;
	onmessage: ((event: {data: In}) => void) | null;
}

export type MainPort = Port<MainToWorker, WorkerToMain>;
export type WorkerPort = Port<WorkerToMain, MainToWorker>;

/** Two ports wired to each other; delivery is asynchronous and structured-cloned, like a real worker. */
export function createPortPair(): [MainPort, WorkerPort] {
	const main: MainPort = {
		onmessage: null,
		postMessage(message) {
			queueMicrotask(() => worker.onmessage?.({data: structuredClone(message)}));
		},
	};
	const worker: WorkerPort = {
		onmessage: null,
		postMessage(message) {
			queueMicrotask(() => main.onmessage?.({data: structuredClone(message)}));
		},
	};

	return [main, worker];
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
