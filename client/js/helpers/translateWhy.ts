// Why a translation action or a model is unavailable, in words. The rule is
// Vue-free and reports codes (translate/models.ts `modelBlock`,
// translate/router.ts `explainRoute` and `translationBlock`); the phrase
// lives here, each reason a whole sentence of its own, so a caller shows it
// beside a lead sentence ("Correcting a message needs the GPU model.")
// rather than splicing one into the other.

import {t} from "../i18n/core";
import friendlysize from "./friendlysize";
import type {RouteBlock} from "../translate/router";

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
				default:
					return t("translate.why.allOff");
			}

		case "down":
			return t("translate.why.down");
		default:
			// "source" never reaches the UI (its questions pass a null source
			// as one the detector will name) and "unserved" is a pair no model
			// covers: both are "nothing here translates this pair".
			return t("translate.why.unserved");
	}
}
