<template>
	<div
		v-if="entry && !entry.hidden && entry.status !== 'dropped'"
		class="msg-translation"
		:data-status="entry.status"
	>
		<button
			ref="chip"
			type="button"
			class="msg-translation-chip"
			:aria-label="chipLabel"
			:title="chipLabel"
			@click.stop="openMenu"
		>
			{{ chipText }}
		</button>
		<SourceLanguagePicker
			v-if="pickerOpen"
			:anchor="chip"
			:selected="entry.from"
			:candidates="entry.candidates"
			@pick="pickSource"
			@close="pickerOpen = false"
		/>
		<span v-if="entry.status === 'failed'" class="msg-translation-failed">
			couldn't translate
			<span v-if="entry.error" class="msg-translation-reason" :title="entry.error">{{
				shortReason(entry.error)
			}}</span>
			<button
				type="button"
				class="msg-translation-retry"
				title="Retry the translation"
				aria-label="Retry the translation"
				@click.stop="retry"
			/>
		</span>
		<span v-else class="msg-translation-text" :lang="entry.to" dir="auto">
			<ParsedMessage
				v-if="entry.text"
				:network="network"
				:message="message"
				:text="entry.text"
			/>
			<span
				v-if="entry.status === 'pending'"
				class="msg-translation-caret"
				aria-hidden="true"
			/>
		</span>
	</div>
</template>

<script lang="ts">
import {computed, defineComponent, PropType, ref} from "vue";
import {writeClipboard} from "../js/clipboard";
import eventbus from "../js/eventbus";
import {useStore} from "../js/store";
import {retranslate, retryTranslation, showOriginal} from "../js/translate/reader";
import {languageName} from "../js/translate/languages";
import type {ClientChan, ClientMessage, ClientNetwork} from "../js/types";
import ParsedMessage from "./ParsedMessage.vue";
import SourceLanguagePicker from "./SourceLanguagePicker.vue";

/** Characters of a failure reason the line shows; the title has all of it. */
const REASON_MAX = 120;

export default defineComponent({
	name: "TranslationLine",
	components: {ParsedMessage, SourceLanguagePicker},
	props: {
		message: {type: Object as PropType<ClientMessage>, required: true},
		channel: {type: Object as PropType<ClientChan>, required: true},
		network: {type: Object as PropType<ClientNetwork>, required: true},
	},
	setup(props) {
		const store = useStore();
		const entry = computed(() => store.state.translations[props.message.id]);
		const chipText = computed(() =>
			entry.value?.from
				? `from ${languageName(entry.value.from, navigator.language)}`
				: "translated"
		);
		const chipLabel = computed(() =>
			entry.value
				? `${chipText.value} into ${languageName(
						entry.value.to,
						navigator.language
				  )}. Translation options`
				: ""
		);

		const chip = ref<HTMLButtonElement | null>(null);
		const pickerOpen = ref(false);

		const retranslateFrom = (from?: string) =>
			retranslate(props.network, props.channel, props.message, from);

		const pickSource = (code: string) => retranslateFrom(code);

		// The detector's runners-up, one click each. The line's own source is
		// not among them: "Retranslate from German" on a line already read as
		// German is just "Retranslate". An explicit source keeps the list, so
		// the way back to the detector's own guess is on the menu too.
		const alternatives = computed(() =>
			(entry.value?.candidates ?? []).filter((code) => code !== entry.value?.from)
		);

		const openMenu = (event: MouseEvent) => {
			eventbus.emit("contextmenu:items", {
				event,
				items: [
					{
						label: "Copy translation",
						type: "item",
						class: "translate-copy",
						// Like the toolbar's Copy: nowhere to report a
						// refused clipboard, so a failure is silent.
						action() {
							void writeClipboard(entry.value?.text ?? "");
						},
					},
					{
						label: "Retranslate",
						type: "item",
						class: "translate-retry",
						action: () => retranslateFrom(),
					},
					...alternatives.value.map((code) => ({
						label: `Retranslate from ${languageName(code, navigator.language)}`,
						type: "item",
						class: "translate-retry-from",
						action: () => retranslateFrom(code),
					})),
					{
						label: "Retranslate from…",
						type: "item",
						class: "translate-retry-pick",
						action() {
							pickerOpen.value = true;
						},
					},
					{
						label: "Show original only",
						type: "item",
						class: "translate-hide",
						action: () => showOriginal(props.message.id, true),
					},
				],
			});
		};

		const retry = () => retryTranslation(props.network, props.channel, props.message);

		// Why it failed, after "couldn't translate": an engine's error can be
		// long and multi-line, so the line shows the head of it and the title
		// carries the whole thing.
		const shortReason = (error: string | null) => {
			if (!error) {
				return "";
			}

			const text = error.replace(/\s+/g, " ").trim();

			return text.length > REASON_MAX ? `${text.slice(0, REASON_MAX - 1)}…` : text;
		};

		return {
			entry,
			chip,
			pickerOpen,
			chipText,
			chipLabel,
			openMenu,
			pickSource,
			retry,
			shortReason,
		};
	},
});
</script>
