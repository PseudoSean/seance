<template>
	<select class="input" :value="modelValue" @change="onChange">
		<option value="auto">{{ autoLabel }}</option>
		<option v-for="entry in options" :key="entry.tag" :value="entry.tag">
			{{ entry.label }}
		</option>
	</select>
</template>

<script lang="ts">
import {computed, defineComponent} from "vue";
import {AVAILABLE, DEV} from "../js/i18n/available";
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

		// The same filter activate() applies to "auto": a dev-only locale (the
		// qqx pseudo locale) is offered only in development builds. Explicit
		// picks are not filtered here — the filter governs what is listed, and
		// an explicitly stored tag activates as chosen in any build.
		const options = computed(() =>
			AVAILABLE.filter(
				(entry: {tag: string; devOnly?: boolean}) => !entry.devOnly || DEV
			).map((entry) => ({
				tag: entry.tag,
				label: nativeName(entry.tag),
			}))
		);

		// Labelled in the language's own name, so the list is findable before
		// the UI speaks the reader's language. Reading locale.value ties the
		// auto label to the resolved tag: it re-renders on a locale change.
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
