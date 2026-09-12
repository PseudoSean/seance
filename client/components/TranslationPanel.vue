<template>
	<!-- One markup, two layouts. The sheet is teleported to <body> so it can
	     cover the whole screen: the desktop panel is absolutely positioned
	     inside the channel view, which clips its overflow. -->
	<Teleport to="body" :disabled="!phone">
		<div
			ref="panel"
			class="translation-panel"
			:class="{'translation-panel--sheet': phone}"
			role="dialog"
			:aria-modal="phone ? 'true' : undefined"
			:aria-label="'Translation for ' + channel.name"
		>
			<div class="translation-panel-title">
				<span class="translation-panel-heading">Translation</span>
				<span class="translation-panel-channel">{{ channel.name }}</span>
				<button
					type="button"
					class="translation-panel-close"
					aria-label="Close"
					title="Close"
					@click="$emit('close')"
				>
					✕
				</button>
			</div>

			<div class="translation-panel-body">
				<section class="translation-panel-section">
					<h3>Reading</h3>
					<label class="translation-panel-field">
						<span class="translation-panel-label">Read messages in</span>
						<select
							name="translateRead"
							class="input translation-panel-control"
							:value="state.read ?? ''"
							@change="onRead"
						>
							<option value="">Off</option>
							<option v-for="code in languages" :key="code" :value="code">
								{{ name(code) }}
							</option>
						</select>
						<span class="translation-panel-hint"
							>Lines others send are shown with a translation underneath.</span
						>
					</label>
				</section>

				<section class="translation-panel-section">
					<h3>Writing</h3>
					<label class="translation-panel-field">
						<span class="translation-panel-label">Send my messages in</span>
						<select
							name="translateWrite"
							class="input translation-panel-control"
							:value="state.write ?? ''"
							@change="onWrite"
						>
							<option value="">Off</option>
							<option v-for="code in languages" :key="code" :value="code">
								{{ name(code) }}
							</option>
						</select>
						<span class="translation-panel-hint"
							>Enter shows the translation first; Enter again sends it.</span
						>
					</label>

					<!-- A native picker is a poor target on a phone: the three
					     choices are a segmented control there. -->
					<div v-if="phone" class="translation-panel-field">
						<span id="translation-panel-formality" class="translation-panel-label"
							>Address people</span
						>
						<div
							class="translation-panel-segmented"
							role="radiogroup"
							aria-labelledby="translation-panel-formality"
						>
							<button
								v-for="option in formalities"
								:key="option.value"
								type="button"
								role="radio"
								name="translateFormality"
								class="translation-panel-segment"
								:aria-checked="state.formality === option.value"
								@click="setFormality(option.value)"
							>
								{{ option.label }}
							</button>
						</div>
					</div>
					<label v-else class="translation-panel-field">
						<span class="translation-panel-label">Address people</span>
						<select
							name="translateFormality"
							class="input translation-panel-control"
							:value="state.formality"
							@change="onFormality"
						>
							<option value="auto">As the original does</option>
							<option value="formal">Formally</option>
							<option value="casual">Casually</option>
						</select>
					</label>

					<label class="translation-panel-field">
						<span class="translation-panel-label">Variant</span>
						<input
							name="translateVariant"
							type="text"
							class="input translation-panel-control"
							:value="state.variant"
							placeholder="e.g. Brazilian Portuguese"
							@change="onVariant"
						/>
						<span class="translation-panel-hint"
							>A regional flavour the model should aim for.</span
						>
					</label>
				</section>
			</div>

			<div class="translation-panel-foot">
				<router-link
					class="translation-panel-more"
					to="/settings/translation"
					@click="$emit('close')"
				>
					Language and models in Settings
				</router-link>
			</div>
		</div>
	</Teleport>
</template>

<script lang="ts">
import {computed, defineComponent, onBeforeUnmount, onMounted, PropType, ref} from "vue";
import {SUPPORTED_LANGUAGES, languageName} from "../js/translate/languages";
import {channelTranslation, setChannelOptions, setReading} from "../js/translate/reader";
import {cancelOutgoing} from "../js/translate/writer";
import {hasVirtualKeyboard} from "../js/helpers/device";
import type {ClientChan, ClientNetwork} from "../js/types";
import type {Formality} from "../js/translate/channelStore";

/** The width below which the panel is a sheet: the phone layout's breakpoint. */
const NARROW = "(max-width: 479px)";

const FORMALITIES: {value: Formality; label: string}[] = [
	{value: "auto", label: "As written"},
	{value: "formal", label: "Formally"},
	{value: "casual", label: "Casually"},
];

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
		const formalities = FORMALITIES;
		const name = (code: string) => languageName(code, navigator.language);
		const valueOf = (event: Event) =>
			(event.target as HTMLSelectElement | HTMLInputElement).value;

		// A touch-primary device has no room for the anchored panel and no
		// pointer for its small controls; so has a window narrow enough that
		// the chat itself is the phone's layout. Read before the first render
		// so the panel is never drawn in the wrong layout and teleported after.
		const narrowQuery =
			typeof window !== "undefined" && typeof window.matchMedia === "function"
				? window.matchMedia(NARROW)
				: null;
		const narrow = ref(narrowQuery ? narrowQuery.matches : false);

		const onNarrow = (event: MediaQueryListEvent) => {
			narrow.value = event.matches;
		};

		const phone = computed(() => hasVirtualKeyboard() || narrow.value);

		const onRead = (event: Event) =>
			setReading(props.network, props.channel, valueOf(event) || null);

		const onWrite = (event: Event) => {
			// A strip already up was translated for the old target: it must not
			// survive the change, finished or not.
			cancelOutgoing(props.channel);
			setChannelOptions(props.network, props.channel, {write: valueOf(event) || null});
		};

		const setFormality = (formality: Formality) =>
			setChannelOptions(props.network, props.channel, {formality});

		const onFormality = (event: Event) => setFormality(valueOf(event) as Formality);
		const onVariant = (event: Event) =>
			setChannelOptions(props.network, props.channel, {variant: valueOf(event).trim()});

		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				emit("close");
			}
		};

		const onPointer = (event: MouseEvent) => {
			// The sheet covers the viewport, so there is no outside to click.
			if (phone.value) {
				return;
			}

			if (panel.value && !panel.value.contains(event.target as Node)) {
				emit("close");
			}
		};

		let pointerTimer: ReturnType<typeof setTimeout> | null = null;

		onMounted(() => {
			document.addEventListener("keydown", onKey);
			narrowQuery?.addEventListener("change", onNarrow);
			// Deferred so the click that opened the panel does not close it.
			pointerTimer = setTimeout(() => document.addEventListener("mousedown", onPointer), 0);
			panel.value?.querySelector("select")?.focus();
		});
		onBeforeUnmount(() => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("mousedown", onPointer);
			narrowQuery?.removeEventListener("change", onNarrow);

			// A panel closed within the tick would otherwise leave the
			// deferred registration to add a listener nothing removes.
			if (pointerTimer !== null) {
				clearTimeout(pointerTimer);
				pointerTimer = null;
			}

			// The caret goes back where it came from — but only when the panel
			// is what holds it: a channel switch closes the panel too, and the
			// composer has just been given the focus for the new conversation.
			if (panel.value?.contains(document.activeElement)) {
				document.querySelector<HTMLElement>("#chat button.translate")?.focus();
			}
		});

		return {
			panel,
			phone,
			state,
			languages,
			formalities,
			name,
			onRead,
			onWrite,
			setFormality,
			onFormality,
			onVariant,
		};
	},
});
</script>
