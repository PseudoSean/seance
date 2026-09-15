<template>
	<select class="input" :value="modelValue" @change="onChange">
		<option value="auto">{{ autoLabel }}</option>
		<option
			v-for="entry in options"
			:key="entry.tag"
			:value="entry.tag"
			:lang="entry.tag"
			:dir="entry.rtl ? 'rtl' : undefined"
		>
			{{ entry.label }}
		</option>
	</select>
</template>

<script lang="ts">
import {computed, defineComponent} from "vue";
import {AVAILABLE, DEV} from "../js/i18n/available";
import {TRANSLATION_TARGETS} from "../js/i18n/targets";
import {isRTL} from "../js/i18n/core";
import {useI18n} from "../js/i18n";

export default defineComponent({
	name: "LanguageSelect",
	props: {
		modelValue: {type: String, required: true},
	},
	emits: {change: (tag: string) => typeof tag === "string"},
	setup(props, {emit}) {
		const {t, locale} = useI18n();

		const nativeName = (tag: string): string => {
			try {
				return new Intl.DisplayNames([tag], {type: "language"}).of(tag) ?? tag;
			} catch {
				return tag; // runtime without that locale data
			}
		};

		// Every target language from translation-languages.txt, in the
		// file's order (English first), plus anything compiled the file does
		// not list (the qqx rig in development). The name is the language's
		// own name — the list is findable before the UI speaks the reader's
		// language. Every entry is pickable: the unified setting is also the
		// reading language, which needs no catalog, and one whose catalog is
		// missing shows English copy until its translation lands.
		const options = computed(() => {
			const merged = new Map<string, {tag: string; en: string | undefined}>();

			for (const target of TRANSLATION_TARGETS) {
				merged.set(target.tag, {tag: target.tag, en: target.en});
			}

			for (const entry of AVAILABLE) {
				if (!merged.has(entry.tag) && (!entry.devOnly || DEV)) {
					merged.set(entry.tag, {tag: entry.tag, en: undefined});
				}
			}

			return [...merged.values()].map((entry) => ({
				tag: entry.tag,
				rtl: isRTL(entry.tag),
				// The language's own name — en resolves to "English", the
				// one deliberate exception the list carries.
				label: nativeName(entry.tag),
			}));
		});

		// Reading locale.value ties the auto label to the resolved tag: it
		// re-renders on a locale change.
		const autoLabel = computed(() => {
			void locale.value; // the resolved tag, never "auto"
			return `${t("settings.locale.auto")} (${nativeName(locale.value)})`;
		});

		const onChange = (event: Event) => {
			emit("change", (event.target as HTMLSelectElement).value);
		};

		return {autoLabel, options, onChange};
	},
});
</script>
