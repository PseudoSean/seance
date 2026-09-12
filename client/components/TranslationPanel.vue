<template>
	<div
		ref="panel"
		class="translation-panel"
		role="dialog"
		aria-label="Translation for this channel"
	>
		<label class="translation-panel-row">
			<span>Read messages in</span>
			<select name="translateRead" :value="state.read ?? ''" @change="onRead">
				<option value="">Off</option>
				<option v-for="code in languages" :key="code" :value="code">
					{{ name(code) }}
				</option>
			</select>
		</label>
		<label class="translation-panel-row">
			<span>Send my messages in</span>
			<select name="translateWrite" :value="state.write ?? ''" @change="onWrite">
				<option value="">Off</option>
				<option v-for="code in languages" :key="code" :value="code">
					{{ name(code) }}
				</option>
			</select>
		</label>
		<label class="translation-panel-row">
			<span>Address people</span>
			<select name="translateFormality" :value="state.formality" @change="onFormality">
				<option value="auto">As the original does</option>
				<option value="formal">Formally</option>
				<option value="casual">Casually</option>
			</select>
		</label>
		<label class="translation-panel-row">
			<span>Variant</span>
			<input
				name="translateVariant"
				type="text"
				:value="state.variant"
				placeholder="e.g. Brazilian Portuguese"
				@change="onVariant"
			/>
		</label>
		<button type="button" class="btn translation-panel-done" @click="$emit('close')">
			Done
		</button>
	</div>
</template>

<script lang="ts">
import {computed, defineComponent, onBeforeUnmount, onMounted, PropType, ref} from "vue";
import {SUPPORTED_LANGUAGES, languageName} from "../js/translate/languages";
import {channelTranslation, setChannelOptions, setReading} from "../js/translate/reader";
import {cancelOutgoing} from "../js/translate/writer";
import type {ClientChan, ClientNetwork} from "../js/types";
import type {Formality} from "../js/translate/channelStore";

export default defineComponent({
	name: "TranslationPanel",
	props: {
		channel: {type: Object as PropType<ClientChan>, required: true},
		network: {type: Object as PropType<ClientNetwork>, required: true},
	},
	emits: ["close"],
	setup(props, {emit}) {
		const panel = ref<HTMLElement | null>(null);
		const state = computed(() => channelTranslation(props.network, props.channel));
		const languages = SUPPORTED_LANGUAGES;
		const name = (code: string) => languageName(code, navigator.language);
		const valueOf = (event: Event) =>
			(event.target as HTMLSelectElement | HTMLInputElement).value;

		const onRead = (event: Event) =>
			setReading(props.network, props.channel, valueOf(event) || null);

		const onWrite = (event: Event) => {
			// A strip already up was translated for the old target: it must not
			// survive the change, finished or not.
			cancelOutgoing(props.channel);
			setChannelOptions(props.network, props.channel, {write: valueOf(event) || null});
		};

		const onFormality = (event: Event) =>
			setChannelOptions(props.network, props.channel, {
				formality: valueOf(event) as Formality,
			});
		const onVariant = (event: Event) =>
			setChannelOptions(props.network, props.channel, {variant: valueOf(event).trim()});

		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				emit("close");
			}
		};

		const onPointer = (event: MouseEvent) => {
			if (panel.value && !panel.value.contains(event.target as Node)) {
				emit("close");
			}
		};

		let pointerTimer: ReturnType<typeof setTimeout> | null = null;

		onMounted(() => {
			document.addEventListener("keydown", onKey);
			// Deferred so the click that opened the panel does not close it.
			pointerTimer = setTimeout(() => document.addEventListener("mousedown", onPointer), 0);
			panel.value?.querySelector("select")?.focus();
		});
		onBeforeUnmount(() => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("mousedown", onPointer);

			// A panel closed within the tick would otherwise leave the
			// deferred registration to add a listener nothing removes.
			if (pointerTimer !== null) {
				clearTimeout(pointerTimer);
				pointerTimer = null;
			}
		});

		return {panel, state, languages, name, onRead, onWrite, onFormality, onVariant};
	},
});
</script>
