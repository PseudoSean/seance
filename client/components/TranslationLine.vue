<template>
	<div
		v-if="entry && !entry.hidden && entry.status !== 'dropped'"
		class="msg-translation"
		:data-status="entry.status"
	>
		<button
			type="button"
			class="msg-translation-chip"
			:aria-label="chipLabel"
			:title="chipLabel"
			@click.stop="openMenu"
		>
			{{ chipText }}
		</button>
		<span v-if="entry.status === 'failed'" class="msg-translation-failed">
			couldn't translate
			<button type="button" class="msg-translation-retry" @click.stop="retry">retry</button>
		</span>
		<span v-else class="msg-translation-text" dir="auto">
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
import {computed, defineComponent, PropType} from "vue";
import eventbus from "../js/eventbus";
import {useStore} from "../js/store";
import {retranslate, retryTranslation, showOriginal} from "../js/translate/reader";
import {languageName} from "../js/translate/languages";
import type {ClientChan, ClientMessage, ClientNetwork} from "../js/types";
import ParsedMessage from "./ParsedMessage.vue";

export default defineComponent({
	name: "TranslationLine",
	components: {ParsedMessage},
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

		const openMenu = (event: MouseEvent) => {
			eventbus.emit("contextmenu:items", {
				event,
				items: [
					{
						label: "Retranslate",
						type: "item",
						class: "translate-retry",
						action: () => retranslate(props.network, props.channel, props.message),
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

		return {entry, chipText, chipLabel, openMenu, retry};
	},
});
</script>
