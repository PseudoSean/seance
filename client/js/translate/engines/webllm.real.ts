// The only import of @mlc-ai/web-llm. Loaded by worker-entry.ts, never by
// a test. WebLLM keeps its weights in Cache Storage under its own keys and
// offers the two helpers the cache API needs.

import {
	MLCEngine,
	deleteModelAllInfoInCache,
	hasModelInCache,
	prebuiltAppConfig,
} from "@mlc-ai/web-llm";
import {ModelRef} from "../engine";
import {CacheApi, ModelCatalog} from "../models";
import {MlcLike, ModelRecord, WebLlmDeps, appConfigFor} from "./webllm";

const prebuilt = prebuiltAppConfig.model_list as ModelRecord[];

export const realWebLlmDeps: WebLlmDeps = {
	prebuilt,
	create(appConfig, onProgress) {
		return new MLCEngine({
			appConfig: {...prebuiltAppConfig, model_list: appConfig.model_list},
			initProgressCallback: (report) =>
				onProgress({progress: report.progress, text: report.text}),
			logLevel: "WARN",
		}) as unknown as MlcLike;
	},
};

/** `has` / `delete` for the LLM; the catalog decides which URLs a mirror uses. */
export function webllmCache(getCatalog: () => ModelCatalog | null): CacheApi {
	const config = (ref: ModelRef) => {
		const catalog = getCatalog();

		return {
			...prebuiltAppConfig,
			model_list: appConfigFor(ref, prebuilt, {
				modelBase: catalog?.modelBase,
				lib: catalog?.llmLib,
			}).model_list,
		};
	};

	return {
		// `async` so that `config()` throwing for a model the library does not
		// know (appConfigFor) rejects rather than throwing at the caller:
		// cacheStates() isolates a rejection to this one row.
		has: async (ref) => await hasModelInCache(ref.id, config(ref)),
		delete: (ref) => deleteModelAllInfoInCache(ref.id, config(ref)),
	};
}
