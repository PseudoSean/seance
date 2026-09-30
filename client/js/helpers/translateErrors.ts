// The failure reasons the translation layer reports are codes, not copy:
// `translate/service.ts`, `translate/client.ts`, `translate/queue.ts` and
// `translate/outgoing.ts` are Vue-free and never import the i18n runtime,
// so the constant's value is an identifier and the phrase lives here, in
// the catalog — one mapping for the reading line and the composer strip.
// Anything else is an engine's own text and renders verbatim.

import {t} from "../i18n/core";
import {WORKER_DISPOSED} from "../translate/client";
import {ABORTED, TIMED_OUT} from "../translate/outgoing";
import {TRANSLATION_UNAVAILABLE} from "../translate/service";

export function translateErrorText(error: string): string {
	if (error === TIMED_OUT) {
		return t("translate.error.timedOut");
	}

	if (error === ABORTED) {
		return t("translate.error.aborted");
	}

	if (error === WORKER_DISPOSED) {
		return t("translate.error.workerDisposed");
	}

	if (error === TRANSLATION_UNAVAILABLE) {
		return t("translate.error.unavailable");
	}

	// The service appends the last load error to the same code when it has
	// one; the detail is the library's own text and stays as it is.
	if (error.startsWith(`${TRANSLATION_UNAVAILABLE}: `)) {
		return t("translate.error.unavailableDetail", {
			detail: error.slice(TRANSLATION_UNAVAILABLE.length + 2),
		});
	}

	return error;
}
