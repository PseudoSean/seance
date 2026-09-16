<template>
	<div>
		<h2>Translation</h2>
		<div v-if="!enabled" class="translate-hint">
			Translation is turned off in this deployment.
		</div>
		<template v-else>
			<div class="translate-hint">
				Messages are translated on this device by a model it downloads once; nothing is sent
				to a translation service. Turn it on per channel from the translate button in the
				channel header.
			</div>
			<label class="opt translate-target">
				<span>Interface and reading language</span>
				<select name="locale" :value="store.state.settings.locale">
					<option value="auto">{{ automaticLabel }}</option>
					<option v-for="code in languages" :key="code" :value="code">
						{{ name(code) }}
					</option>
				</select>
			</label>
			<div class="translate-hint">
				The language the interface is written in and messages are translated into — one
				control. Automatic follows your browser's language.
			</div>
			<div
				v-if="effectiveReading && limited(effectiveReading)"
				class="translate-hint translate-limited"
			>
				Translations into and out of this language are often wrong.
			</div>
			<div
				id="label-translate-formality"
				class="translate-hint"
				role="heading"
				aria-level="3"
			>
				Address people
			</div>
			<div role="group" aria-labelledby="label-translate-formality">
				<label class="opt">
					<input
						:checked="store.state.settings.translateFormality === 'auto'"
						type="radio"
						name="translateFormality"
						value="auto"
					/>
					As the original does
				</label>
				<label class="opt">
					<input
						:checked="store.state.settings.translateFormality === 'formal'"
						type="radio"
						name="translateFormality"
						value="formal"
					/>
					Formally
				</label>
				<label class="opt">
					<input
						:checked="store.state.settings.translateFormality === 'casual'"
						type="radio"
						name="translateFormality"
						value="casual"
					/>
					Casually
				</label>
			</div>
			<h3>Models</h3>
			<div v-if="problem" class="translate-hint translate-error">
				Could not reach the translation worker: {{ problem }}
			</div>
			<div v-if="capability" class="translate-hint translate-device">
				<template v-if="capability.tier === 'gpu'"
					>This device can run the GPU model.</template
				>
				<template v-else-if="capability.tier === 'cpu'">
					The GPU model is unavailable here ({{ capability.reasons.join(", ") }}); the CPU
					models still work.
				</template>
				<template v-else>
					Translation cannot run on this device ({{ capability.reasons.join(", ") }}).
				</template>
			</div>
			<label class="opt">
				<input
					:checked="store.state.settings.translateLlm"
					type="checkbox"
					name="translateLlm"
				/>
				Use the GPU model where it is the better choice
			</label>
			<label class="opt">
				<input
					:checked="store.state.settings.translateCpu"
					type="checkbox"
					name="translateCpu"
				/>
				Use the CPU models where they are the better choice
			</label>
			<label class="opt translate-llm-model">
				<span>GPU model</span>
				<select name="translateLlmModel" :value="selectedLlm.id">
					<option value="">Automatic — best for this device</option>
					<option v-for="choice in llmChoices" :key="choice.id" :value="choice.id">
						{{ llmName(choice) }} · {{ size(choice.sizeBytes) }}
					</option>
				</select>
			</label>
			<div class="translate-hint translate-llm-hint">
				The larger model translates more naturally, needs about 3.4 GB of graphics memory
				and is slower.
			</div>
			<ul class="translate-models">
				<li
					v-for="view in models"
					:key="view.ref.id"
					class="translate-model"
					:data-model="view.ref.id"
					:data-status="view.status"
				>
					<span class="translate-model-name"
						>{{ view.ref.label }}
						<span
							v-if="view.ref.engine === 'llm' && view.ref.id === selectedLlm.id"
							class="translate-model-in-use"
							>In use</span
						></span
					>
					<span class="translate-model-size">{{ size(view.ref.sizeBytes) }}</span>
					<span class="translate-model-state">{{ stateLabel(view) }}</span>
					<span v-if="view.status === 'downloading'" class="translate-model-track">
						<span
							class="translate-model-fill"
							:style="{width: Math.round(view.fraction * 100) + '%'}"
						/>
					</span>
					<button
						v-if="!view.cached && view.status !== 'downloading'"
						type="button"
						class="btn translate-model-download"
						:disabled="!allowed(view.ref)"
						@click.prevent="download(view.ref)"
					>
						Download
					</button>
					<button
						v-else-if="view.cached"
						type="button"
						class="btn translate-model-delete"
						@click.prevent="remove(view.ref)"
					>
						Delete
					</button>
				</li>
			</ul>
		</template>
	</div>
</template>

<style>
.translate-hint {
	margin-bottom: 0.75rem;
	color: var(--body-color-muted);
}

.translate-target select,
.translate-llm-model select {
	margin-left: 0.5rem;
}

.translate-model-in-use {
	margin-left: 0.5rem;
	padding: 0 0.375rem;
	border-radius: 0.25rem;
	font-size: 0.85em;
	color: var(--chat-accent, var(--link-color));
	border: 1px solid currentcolor;
	white-space: nowrap;
}

.translate-models {
	list-style: none;
	padding: 0;
	margin: 0.75rem 0 0;
}

/*
 * The name takes a row of its own: model labels run to "NLLB-200 600M
 * (CPU, 200 languages)", and sharing the row with the size, the state and
 * an uppercase Download button left it wrapping to four lines. Size and
 * state sit under it on the left, the button on the right; the progress
 * track, when there is one, takes a full row below both.
 */
.translate-model {
	display: grid;
	grid-template-areas:
		"name name name"
		"size state action";
	grid-template-columns: auto 1fr auto;
	gap: 0.25rem 0.75rem;
	align-items: center;
	padding: 0.5rem 0;
	border-top: 1px solid var(--window-border, rgb(128 128 128 / 20%));
}

.translate-model-name {
	grid-area: name;
}

.translate-model-size {
	grid-area: size;
}

.translate-model-state {
	grid-area: state;
}

.translate-model-download,
.translate-model-delete {
	grid-area: action;
	justify-self: end;
}

.translate-model-size,
.translate-model-state {
	color: var(--body-color-muted);
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}

.translate-model[data-status="failed"] .translate-model-state {
	color: var(--error-fg, #c33);
}

.translate-error {
	color: var(--error-fg, #c33);
}

/* No area of its own: it is auto-placed into a row below the named ones,
   so a row without a track has no empty row and no gap for it. */
.translate-model-track {
	grid-column: 1 / -1;
	display: block;
	margin-top: 0.25rem;
	height: 0.375rem;
	border-radius: 0.25rem;
	background: var(--tint-strong, rgb(128 128 128 / 20%));
	overflow: hidden;
}

.translate-model-fill {
	display: block;
	height: 100%;
	background: var(--chat-accent, var(--link-color));
	transition: width 0.15s linear;
}

@media (max-width: 480px) {
	.translate-model {
		grid-template-areas:
			"name name"
			"size state"
			"action action";
		grid-template-columns: auto 1fr;
	}

	.translate-model-download,
	.translate-model-delete {
		justify-self: start;
	}
}
</style>

<script lang="ts">
import {computed, defineComponent, onMounted, ref, toRaw} from "vue";
import {useStore} from "../../js/store";
import {translateService} from "../../js/translate";
import type {ModelRef} from "../../js/translate/engine";
import {llmChoice, llmName} from "../../js/translate/models";
import {isLimitedLanguage} from "../../js/translate/routes.default";
import {
	SUPPORTED_LANGUAGES,
	browserLanguage,
	languageOptionLabel,
} from "../../js/translate/languages";
import {readingLanguage} from "../../js/translate/reader";
import type {ModelView} from "../../js/translate/service";

export default defineComponent({
	name: "TranslationSettings",
	setup() {
		const store = useStore();
		const service = translateService();
		const enabled = service.enabled;
		const models = computed(() => store.state.translation.models);
		const capability = computed(() => store.state.translation.capability);
		const name = (code: string) => languageOptionLabel(code);
		const languages = [...SUPPORTED_LANGUAGES].sort((a, b) => name(a).localeCompare(name(b)));
		// The Automatic option names the browser's language: what a new user
		// sees selected is the language their browser asked for.
		const automaticLabel = `Automatic — ${name(
			browserLanguage(navigator.language)
		)} (follows your browser)`;
		// The reading language as it stands: the interface's (one control —
		// reactivity rides on the store read and the i18n ref the helper reads).
		const effectiveReading = computed(() => readingLanguage());
		const loadError = ref<string | null>(null);
		// Two ways the worker can disappoint this tab: a call it made rejected
		// (loadError), or the worker reported a problem of its own that no call
		// was waiting for (the store's workerError, set by index.ts).
		const problem = computed(() => store.state.translation.workerError ?? loadError.value);
		const llmChoices = service.catalog.llmChoices;
		// The setting as the service reads it: an id that is no longer a
		// choice shows (and runs) the default.
		const selectedLlm = computed(() =>
			llmChoice(service.catalog, store.state.settings.translateLlmModel)
		);
		const limited = (code: string | null) => isLimitedLanguage(code, selectedLlm.value.id);

		const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

		onMounted(() => {
			if (enabled) {
				service.models().catch((e: unknown) => {
					loadError.value = errorMessage(e);
				});
			}
		});

		const size = (bytes: number) =>
			bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

		const stateLabel = (view: ModelView) => {
			switch (view.status) {
				case "downloading":
					// Already on this device: the row is loading it, not downloading it.
					return view.cached
						? `Loading… ${Math.round(view.fraction * 100)}%`
						: `${Math.round(view.fraction * 100)}%`;
				case "ready":
					return "Downloaded";
				case "failed":
					return `Failed: ${view.error ?? "unknown error"}`;
				default:
					return view.cached ? "Downloaded" : "Not downloaded";
			}
		};

		const allowed = (modelRef: ModelRef) => {
			const cap = capability.value;

			if (!cap) {
				return false;
			}

			return modelRef.engine === "llm" ? cap.tier === "gpu" : cap.tier !== "none";
		};

		// The ref comes off a reactive `v-for` row (store.state.translation.models);
		// the worker protocol structured-clones every message, which rejects a
		// Vue reactive Proxy, so send the raw object underneath it.
		const download = (modelRef: ModelRef) => {
			service.download(toRaw(modelRef)).catch(() => {
				// the view carries the error; nothing else to do
			});
		};

		const remove = (modelRef: ModelRef) => {
			service.deleteModel(toRaw(modelRef)).catch((e: unknown) => {
				loadError.value = errorMessage(e);
			});
		};

		return {
			store,
			enabled,
			models,
			capability,
			languages,
			limited,
			automaticLabel,
			effectiveReading,
			llmChoices,
			selectedLlm,
			llmName,
			loadError,
			problem,
			name,
			size,
			stateLabel,
			allowed,
			download,
			remove,
		};
	},
});
</script>
