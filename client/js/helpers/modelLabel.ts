// How a translation model is named on screen. `ModelRef.label` is data (a
// kind plus its values) because `translate/models.ts` is Vue-free and never
// imports the i18n runtime; the phrase itself lives in the catalog and is
// rendered here, once, for the three surfaces that show a model: Settings →
// Translation, the composer's translation strip and a reading line's
// "downloading…" note.

import {t} from "../i18n/core";
import type {ModelRef} from "../translate/engine";
import {languageName} from "../translate/languages";
import type {LoadNote} from "../translate/service";

/** The model's full name, as Settings lists it. */
export function modelLabel(ref: ModelRef): string {
	switch (ref.label.kind) {
		case "opus":
			return t("translate.model.opus", {
				from: languageName(ref.label.from),
				to: languageName(ref.label.to),
			});
		case "nllb":
			return t("translate.model.nllb");
		default:
			return t("translate.model.llm", {name: ref.label.name});
	}
}

/** What a strip or a reading line says while this model loads. */
export function loadNoteText(note: LoadNote): string {
	const vars = {model: modelLabel(note.ref), percent: note.percent};

	return note.phase === "loading"
		? t("translate.load.loading", vars)
		: t("translate.load.downloading", vars);
}
