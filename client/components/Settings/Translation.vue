<template>
	<div>
		<h2>{{ t("translate.settings.heading") }}</h2>
		<div v-if="!enabled" class="translate-hint">
			{{ t("translate.settings.disabled") }}
		</div>
		<template v-else>
			<div class="translate-hint">{{ t("translate.settings.intro") }}</div>
			<label class="opt translate-target">
				<span>{{ t("translate.settings.languageLabel") }}</span>
				<!-- The one language control the whole app uses (the sidebar
				     globe renders the same component): one list of codes, one
				     "Automatic" label. `name` is not a prop, so it falls
				     through onto the <select> and the settings container's
				     change handler stores it like any other field. -->
				<LanguageSelect name="locale" :model-value="store.state.settings.locale" />
			</label>
			<div class="translate-hint">{{ t("translate.settings.languageHint") }}</div>
			<div
				v-if="effectiveReading && limited(effectiveReading)"
				class="translate-hint translate-limited"
			>
				{{ t("translate.limitedLanguage") }}
			</div>
			<div
				id="label-translate-formality"
				class="translate-hint"
				role="heading"
				aria-level="3"
			>
				{{ t("translate.formality.label") }}
			</div>
			<div role="group" aria-labelledby="label-translate-formality">
				<label class="opt">
					<input
						:checked="store.state.settings.translateFormality === 'auto'"
						type="radio"
						name="translateFormality"
						value="auto"
					/>
					{{ t("translate.formality.auto") }}
				</label>
				<label class="opt">
					<input
						:checked="store.state.settings.translateFormality === 'formal'"
						type="radio"
						name="translateFormality"
						value="formal"
					/>
					{{ t("translate.formality.formal") }}
				</label>
				<label class="opt">
					<input
						:checked="store.state.settings.translateFormality === 'casual'"
						type="radio"
						name="translateFormality"
						value="casual"
					/>
					{{ t("translate.formality.casual") }}
				</label>
			</div>
			<h3>{{ t("translate.settings.models") }}</h3>
			<div v-if="problem" class="translate-hint translate-error">
				{{ t("translate.settings.workerError", {error: problem}) }}
			</div>
			<div v-if="capability" class="translate-hint translate-device">
				<template v-if="capability.tier === 'gpu'">{{
					t("translate.capability.gpu")
				}}</template>
				<template v-else-if="capability.tier === 'cpu'">{{
					t("translate.capability.cpu")
				}}</template>
				<template v-else>{{ t("translate.capability.none") }}</template>
				<!-- Each reason is a phrase of its own: a translator is never
				     handed a list glued together with a comma. -->
				<ul v-if="capability.reasons.length" class="translate-device-reasons">
					<li v-for="reason in capability.reasons" :key="reason">
						{{ reasonText(reason) }}
					</li>
				</ul>
			</div>
			<label class="opt">
				<input
					:checked="store.state.settings.translateLlm"
					type="checkbox"
					name="translateLlm"
				/>
				{{ t("translate.settings.useGpu") }}
			</label>
			<label class="opt">
				<input
					:checked="store.state.settings.translateCpu"
					type="checkbox"
					name="translateCpu"
				/>
				{{ t("translate.settings.useCpu") }}
			</label>
			<label class="opt translate-llm-model">
				<span>{{ t("translate.settings.gpuModel") }}</span>
				<!-- The raw setting, not the resolved choice: "" is Automatic, and
					     binding the resolved id would show the deploy's default as
					     an explicit pick that Automatic could never win back. The
					     "in use" tag below names what "" resolves to. -->
				<select name="translateLlmModel" :value="store.state.settings.translateLlmModel">
					<option value="">{{ t("translate.settings.gpuAutomatic") }}</option>
					<option v-for="choice in llmChoices" :key="choice.id" :value="choice.id">
						{{
							t("translate.settings.modelOption", {
								name: llmName(choice),
								size: size(choice.sizeBytes),
							})
						}}
					</option>
				</select>
			</label>
			<div class="translate-hint translate-llm-hint">
				{{ t("translate.settings.gpuModelHint") }}
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
						>{{ modelLabel(view.ref) }}
						<span
							v-if="view.ref.engine === 'llm' && view.ref.id === selectedLlm.id"
							class="translate-model-in-use"
							>{{ t("translate.settings.inUse") }}</span
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
						{{ t("translate.model.download") }}
					</button>
					<button
						v-else-if="view.cached"
						type="button"
						class="btn translate-model-delete"
						@click.prevent="remove(view.ref)"
					>
						{{ t("translate.model.delete") }}
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
	margin-inline-start: 0.5rem;
}

.translate-model-in-use {
	margin-inline-start: 0.5rem;
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

/* The device-tier reasons: each a phrase of its own, not a comma list. */
.translate-device-reasons {
	margin: 0.25rem 0 0;
	padding-inline-start: 1.25rem;
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
import {useI18n} from "../../js/i18n";
import friendlysize from "../../js/helpers/friendlysize";
import {modelLabel} from "../../js/helpers/modelLabel";
import {useStore} from "../../js/store";
import {translateService} from "../../js/translate";
import type {ModelRef} from "../../js/translate/engine";
import {llmChoice, llmName} from "../../js/translate/models";
import {isLimitedLanguage} from "../../js/translate/routes.default";
import {readingLanguage} from "../../js/translate/reader";
import type {CapabilityReason} from "../../js/translate/capability";
import type {ModelView} from "../../js/translate/service";
import LanguageSelect from "../LanguageSelect.vue";

export default defineComponent({
	name: "TranslationSettings",
	components: {LanguageSelect},
	setup() {
		const {t} = useI18n();
		const store = useStore();
		const service = translateService();
		const enabled = service.enabled;
		const models = computed(() => store.state.translation.models);
		const capability = computed(() => store.state.translation.capability);
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

		// The shared size formatter: the number is written by the active
		// locale, the IEC unit symbol is universal (helpers/friendlysize.ts).
		const size = (bytes: number) => friendlysize(bytes);

		// Why the GPU tier is out of reach, one whole phrase per code
		// (translate/capability.ts is Vue-free and reports codes). Every code
		// has a case of its own, including NO_WEBGPU, which used to be the
		// unnamed default. The `never` binding is the exhaustiveness check a
		// type-checker that reads this script block would trip over -- nothing
		// in this build's pipeline does today (webpack strips the SFC's types
		// and ForkTsChecker does not read .vue), so the default still returns
		// prose: a code with no phrase reads as "no WebGPU" rather than
		// putting a raw enum token, untranslated, on the screen.
		const reasonText = (reason: CapabilityReason): string => {
			switch (reason) {
				case "NO_WEBGPU":
					return t("translate.capability.reason.noWebgpu");
				case "INSECURE_ORIGIN":
					return t("translate.capability.reason.insecureOrigin");
				case "NO_ADAPTER":
					return t("translate.capability.reason.noAdapter");
				case "NO_F16":
					return t("translate.capability.reason.noF16");
				case "SMALL_BUFFER":
					return t("translate.capability.reason.smallBuffer");
				case "NO_WASM_SIMD":
					return t("translate.capability.reason.noWasmSimd");
				case "PROBE_FAILED":
					return t("translate.capability.reason.probeFailed");

				default: {
					const unhandled: never = reason;

					void unhandled;

					return t("translate.capability.reason.noWebgpu");
				}
			}
		};

		const stateLabel = (view: ModelView) => {
			const percent = Math.round(view.fraction * 100);

			switch (view.status) {
				case "downloading":
					// Already on this device: the row is loading it, not downloading it.
					return view.cached
						? t("translate.model.loadingPercent", {percent})
						: t("translate.model.percent", {percent});
				case "ready":
					return t("translate.model.downloaded");
				case "failed":
					return view.error
						? t("translate.model.failed", {error: view.error})
						: t("translate.model.failedUnknown");
				default:
					return view.cached
						? t("translate.model.downloaded")
						: t("translate.model.notDownloaded");
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
			t,
			modelLabel,
			reasonText,
			store,
			enabled,
			models,
			capability,
			limited,
			effectiveReading,
			llmChoices,
			selectedLlm,
			llmName,
			loadError,
			problem,
			size,
			stateLabel,
			allowed,
			download,
			remove,
		};
	},
});
</script>
