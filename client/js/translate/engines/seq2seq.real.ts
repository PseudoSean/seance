// The only import of @huggingface/transformers. Loaded by worker-entry.ts,
// never by a test. `configureTransformers` runs once per worker from the
// protocol's `configure` message: the mirror (or Hugging Face), the ORT
// wasm files the build copies to js/ort/, and the browser cache the
// library keeps under the "transformers-cache" Cache Storage name.

import {env, pipeline} from "@huggingface/transformers";
import {CacheApi} from "../models";
import {PipelineLike, Seq2seqDeps} from "./seq2seq";

const CACHE_NAME = "transformers-cache";

export function configureTransformers(options: {modelBase?: string; ortBase: string}): void {
	env.allowLocalModels = false;
	env.useBrowserCache = true;

	if (options.modelBase) {
		env.remoteHost = `${options.modelBase}/`;
		env.remotePathTemplate = "{model}/";
	}

	env.backends.onnx.wasm.wasmPaths = options.ortBase;
}

export const realSeq2seqDeps: Seq2seqDeps = {
	async pipeline(modelId, onProgress) {
		const pipe = await pipeline("translation", modelId, {
			dtype: "q8",
			device: "wasm",
			progress_callback(report: {
				status: string;
				file?: string;
				loaded?: number;
				total?: number;
			}) {
				if (report.status === "progress" && report.file && report.total) {
					onProgress({
						file: report.file,
						loaded: report.loaded ?? 0,
						total: report.total,
					});
				}
			},
		});

		return pipe as unknown as PipelineLike;
	},
	threads: () => typeof SharedArrayBuffer !== "undefined",
};

/** The library caches every file under a URL containing the repo id. */
export function seq2seqCache(): CacheApi {
	const keysFor = async (id: string) => {
		const cache = await caches.open(CACHE_NAME);
		const keys = await cache.keys();

		return {cache, keys: keys.filter((request) => request.url.includes(`/${id}/`))};
	};

	return {
		has: async (ref) => (await keysFor(ref.id)).keys.length > 0,
		async delete(ref) {
			const {cache, keys} = await keysFor(ref.id);

			for (const key of keys) {
				await cache.delete(key);
			}
		},
	};
}
