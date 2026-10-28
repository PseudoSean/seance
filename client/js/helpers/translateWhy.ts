// Why a translation action or a model is unavailable, in words. The rule is
// Vue-free and reports codes (translate/models.ts `modelBlock`,
// translate/router.ts `explainRoute` and `translationBlock`); the phrase
// lives here, each reason a whole sentence of its own, so a caller shows it
// beside a lead sentence ("Correcting a message needs the GPU model.")
// rather than splicing one into the other.

import {activeLocale, t} from "../i18n/core";
import friendlysize from "./friendlysize";
import type {ModelRef} from "../translate/engine";
import {languageName} from "../translate/languages";
import type {RouteBlock} from "../translate/router";

/**
 * A model's name as Settings lists it (helpers/modelLabel.ts), from its
 * label alone and without the store: the download question and the reason
 * a declined download gives are built where the store is not loaded
 * (translate/index.ts, the error text under mocha). The pair is named in
 * the interface's language, which is the reading language.
 */
export function modelDisplayName(ref: Pick<ModelRef, "label">): string {
	switch (ref.label.kind) {
		case "opus":
			return t("translate.model.opus", {
				from: languageName(ref.label.from, activeLocale()),
				to: languageName(ref.label.to, activeLocale()),
			});
		case "nllb":
			return t("translate.model.nllb");
		default:
			return t("translate.model.llm", {name: ref.label.name});
	}
}

/** "Needs downloading <model> (<size>)", with the way to do it. */
export function needsDownloadText(ref: Pick<ModelRef, "label" | "sizeBytes">): string {
	return t("translate.why.needsDownload", {
		model: modelDisplayName(ref),
		size: friendlysize(ref.sizeBytes),
	});
}

export function translateWhyText(block: RouteBlock): string {
	switch (block.kind) {
		case "disabled":
			return t("translate.settings.disabled");
		case "probing":
			return t("translate.why.probing");

		case "device":
			switch (block.reason) {
				case "INSECURE_ORIGIN":
					return t("translate.why.insecureOrigin");
				case "NO_ADAPTER":
					return t("translate.why.noAdapter");
				case "NO_F16":
					return t("translate.why.noF16");
				case "GPU_LIMITS":
					return t("translate.why.gpuLimits");
				case "NO_WASM_SIMD":
					return t("translate.why.noWasmSimd");
				case "PROBE_FAILED":
					return t("translate.why.probeFailed");
				default:
					return t("translate.why.noWebgpu");
			}

		case "buffer":
			return t("translate.model.needsBuffer", {
				needed: friendlysize(block.needed),
				limit: friendlysize(block.limit),
			});

		case "off":
			switch (block.engine) {
				case "llm":
					return t("translate.why.llmOff");
				case "seq2seq":
					return t("translate.why.cpuOff");
				case "nllb":
					return t("translate.why.nllbOff");
				default:
					return t("translate.why.allOff");
			}

		case "down":
			return t("translate.why.down");
		case "download":
			return needsDownloadText(block.ref);
		default:
			// "source" never reaches the UI (its questions pass a null source
			// as one the detector will name) and "unserved" is a pair no model
			// covers: both are "nothing here translates this pair".
			return t("translate.why.unserved");
	}
}
