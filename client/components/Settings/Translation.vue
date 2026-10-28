<template>
	<div>
		<h2>{{ t("translate.settings.heading") }}</h2>
		<div v-if="enabled" class="translate-hint">{{ t("translate.settings.intro") }}</div>
		<!-- Outside the enabled branch: this is the production build's only
		     interface-language picker, and a deploy that turns translation
		     off still has readers who want German. There it is the interface
		     language alone, and says so. -->
		<label class="opt translate-target">
			<span>{{
				enabled
					? t("translate.settings.languageLabel")
					: t("translate.settings.interfaceLanguageLabel")
			}}</span>
			<!-- The one language control the whole app uses (the sidebar
			     globe renders the same component): one list of codes, one
			     "Automatic" label. `name` is not a prop, so it falls
			     through onto the <select> and the settings container's
			     change handler stores it like any other field. -->
			<LanguageSelect name="locale" :model-value="store.state.settings.locale" />
		</label>
		<div v-if="!enabled" class="translate-hint">
			{{ t("translate.settings.disabled") }}
		</div>
		<template v-else>
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
				<!-- What the GPU binds in one buffer: whether a GPU model can
				     load is that number against its largest tensor. -->
				<span v-if="capability.maxBufferBytes > 0" class="translate-device-limit">{{
					t("translate.capability.bufferLimit", {size: size(capability.maxBufferBytes)})
				}}</span>
				<!-- The test switch (translate/gpuTestLimit.ts) is on: the
				     limit above is the switch's, not the GPU's. -->
				<span v-if="capability.bufferCapBytes" class="translate-device-test-limit">{{
					t("translate.capability.testLimit", {
						size: size(capability.bufferCapBytes),
						key: testLimitKey,
					})
				}}</span>
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
					v-switch
					:checked="store.state.settings.translateLlm"
					type="checkbox"
					name="translateLlm"
				/>
				{{ t("translate.settings.useGpu") }}
			</label>
			<label class="opt">
				<input
					v-switch
					:checked="store.state.settings.translateCpu"
					type="checkbox"
					name="translateCpu"
				/>
				{{ t("translate.settings.useCpu") }}
			</label>
			<!-- NLLB-200 is opt-in: its licence is non-commercial, so it is
			     off until the user switches it on; the OPUS-MT pairs and the
			     GPU model serve without it. The licence line describes the
			     switch, so a screen reader hears why it is off. -->
			<label class="opt translate-nllb">
				<input
					v-switch
					:checked="!!store.state.settings.translateNllb"
					type="checkbox"
					name="translateNllb"
					aria-describedby="translate-nllb-licence"
				/>
				{{ t("translate.settings.useNllb") }}
			</label>
			<div id="translate-nllb-licence" class="translate-hint translate-nllb-licence">
				{{ t("translate.settings.nllbLicence") }}
			</div>
			<label class="opt translate-llm-model">
				<span>{{ t("translate.settings.gpuModel") }}</span>
				<!-- The raw setting, not the resolved choice: "" is Automatic, and
					     binding the resolved id would show the deploy's default as
					     an explicit pick that Automatic could never win back. The
					     "in use" tag below names what "" resolves to. -->
				<select
					name="translateLlmModel"
					:value="store.state.settings.translateLlmModel"
					:aria-describedby="unfitLlms.length ? 'translate-llm-unfit' : undefined"
				>
					<option value="">{{ t("translate.settings.gpuAutomatic") }}</option>
					<!-- A model this GPU cannot bind is greyed: chosen, it would
					     not run, and the default would run in its place. -->
					<option
						v-for="choice in llmChoices"
						:key="choice.id"
						:value="choice.id"
						:disabled="!!llmUnfit(choice)"
					>
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
			<div v-if="unfitLlms.length" id="translate-llm-unfit" class="translate-hint">
				<p v-for="choice in unfitLlms" :key="choice.id" class="translate-llm-unfit">
					{{ t("translate.settings.gpuModelUnfit", {model: llmName(choice)}) }}
					{{ whyText(llmUnfit(choice)!) }}
				</p>
			</div>
			<ul class="translate-models">
				<li
					v-for="(view, index) in models"
					:key="view.ref.id"
					class="translate-model"
					:data-model="view.ref.id"
					:data-status="view.status"
					:data-runs="runsState(view.ref)"
				>
					<span class="translate-model-name"
						><span :id="'translate-model-name-' + index">{{
							modelLabel(view.ref)
						}}</span>
						<!-- No GPU model is in use on a device that can run none:
						     the selection then only keys the route table. -->
						<span
							v-if="
								view.ref.engine === 'llm' &&
								view.ref.id === selectedLlm.id &&
								runsState(view.ref) !== 'cannot'
							"
							class="translate-model-in-use"
							>{{ t("translate.settings.inUse") }}</span
						></span
					>
					<span class="translate-model-size">{{ size(view.ref.sizeBytes) }}</span>
					<span class="translate-model-state">{{ stateLabel(view) }}</span>
					<!-- Whether it can run here, and if not why: the verdict and
					     the reason are two whole sentences, never one spliced
					     into the other. The reason is the Download button's
					     description, so a screen reader hears why it is off. -->
					<span class="translate-model-runs">{{ runsLabel(view.ref) }}</span>
					<span
						v-if="whyLabel(view.ref)"
						:id="'translate-model-why-' + index"
						class="translate-model-why"
						>{{ whyLabel(view.ref) }}</span
					>
					<!-- This GPU binds too little for the model itself: what
					     Download fetches and what runs is its small-buffer build
					     (models.ts smallBufferBuildFor), with its own need. -->
					<span
						v-if="smallBuild(view.ref)"
						class="translate-model-small-build"
						:data-build="smallBuild(view.ref)!.id"
						>{{
							t("translate.model.smallBufferBuild", {
								size: size(smallBuild(view.ref)!.largestBufferBytes),
							})
						}}</span
					>
					<span
						v-if="view.status === 'downloading'"
						class="translate-model-track"
						role="progressbar"
						aria-valuemin="0"
						aria-valuemax="100"
						:aria-valuenow="Math.round(view.fraction * 100)"
						:aria-valuetext="stateLabel(view)"
						:aria-labelledby="'translate-model-name-' + index"
					>
						<span
							class="translate-model-fill"
							:style="{width: Math.round(view.fraction * 100) + '%'}"
						/>
					</span>
					<!-- Named "Download <model>" (the button, then the row's name):
					     fifteen buttons that all read "Download" say nothing to a
					     screen reader moving between them. -->
					<button
						v-if="!view.cached && view.status !== 'downloading'"
						:id="'translate-model-action-' + index"
						type="button"
						class="btn translate-model-download"
						:aria-labelledby="
							'translate-model-action-' + index + ' translate-model-name-' + index
						"
						:disabled="!allowed(view.ref)"
						:aria-describedby="
							whyLabel(view.ref) ? 'translate-model-why-' + index : undefined
						"
						@click.prevent="download(view.ref)"
					>
						{{ t("translate.model.download") }}
					</button>
					<button
						v-else-if="view.cached"
						:id="'translate-model-action-' + index"
						type="button"
						class="btn translate-model-delete"
						:aria-labelledby="
							'translate-model-action-' + index + ' translate-model-name-' + index
						"
						@click.prevent="remove(view.ref)"
					>
						{{ t("translate.model.delete") }}
					</button>
				</li>
			</ul>
			<!-- A download's end, said once: the rows' own percentages are not
			     live, they would chatter for minutes. -->
			<div class="sr-only" role="status" aria-live="polite">{{ announcement }}</div>
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
	/* minmax(0, …): a long state ("Nicht heruntergeladen") wraps in its
	   own cell instead of pushing the button out past the column. */
	grid-template-columns: auto minmax(0, 1fr) auto;
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
	min-width: 0;
}

.translate-model-download,
.translate-model-delete {
	grid-area: action;
	justify-self: end;
}

/* A model this device cannot run: the button reads as off, not as the
   filled look .btn:disabled gives a primary action. */
.translate-model-download:disabled {
	background: none;
	color: var(--body-color-muted);
	cursor: default;
}

.translate-model-size,
.translate-model-state {
	color: var(--body-color-muted);
	font-variant-numeric: tabular-nums;
}

.translate-model-size {
	white-space: nowrap;
}

.translate-model[data-status="failed"] .translate-model-state {
	color: var(--error-fg, #c33);
}

/* Whether the model can run here, and why not: rows of their own. */
.translate-model-runs,
.translate-model-why,
.translate-model-small-build {
	grid-column: 1 / -1;
}

.translate-model[data-runs="cannot"] .translate-model-runs {
	color: var(--error-fg, #c33);
}

.translate-model[data-runs="off"] .translate-model-runs,
.translate-model-why,
.translate-model-small-build {
	color: var(--body-color-muted);
}

.translate-device-limit,
.translate-device-test-limit {
	display: block;
}

.translate-llm-unfit {
	margin: 0;
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
import {computed, defineComponent, onMounted, ref, toRaw, watch} from "vue";
import {useI18n} from "../../js/i18n";
import friendlysize from "../../js/helpers/friendlysize";
import {modelLabel} from "../../js/helpers/modelLabel";
import {useStore} from "../../js/store";
import {translateService} from "../../js/translate";
import type {ModelRef} from "../../js/translate/engine";
import {
	LLM_MIN_BUFFER_BYTES,
	llmChoice,
	llmName,
	modelBlock,
	smallBufferBuildFor,
} from "../../js/translate/models";
import {GPU_TEST_LIMIT_KEY} from "../../js/translate/gpuTestLimit";
import {translateErrorText} from "../../js/helpers/translateErrors";
import {translateWhyText} from "../../js/helpers/translateWhy";
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
		// A code the translation layer reports (a worker that never started is
		// TRANSLATION_UNAVAILABLE) in the reader's words; an engine's own text
		// as it is.
		const problem = computed(() => {
			const raw = store.state.translation.workerError ?? loadError.value;

			return raw ? translateErrorText(raw) : null;
		});
		const llmChoices = service.catalog.llmChoices;
		// The setting as the service reads it: an id that is no longer a
		// choice — an unset one included — shows (and runs) what the service
		// resolves it to. The device probe is read here, not captured, so
		// the "in use" tag moves to the adapter's pick when it lands.
		const selectedLlm = computed(() =>
			llmChoice(
				service.catalog,
				store.state.settings.translateLlmModel,
				store.state.translation.capability
			)
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
				case "GPU_LIMITS":
					return t("translate.capability.reason.gpuLimits");
				case "SMALL_BUFFER":
					return t("translate.capability.reason.smallBuffer", {
						limit: size(capability.value?.maxBufferBytes ?? 0),
						needed: size(LLM_MIN_BUFFER_BYTES),
					});
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
						? t("translate.model.failed", {error: translateErrorText(view.error)})
						: t("translate.model.failedUnknown");
				default:
					return view.cached
						? t("translate.model.downloaded")
						: t("translate.model.notDownloaded");
			}
		};

		// What keeps a model from running here (models.ts `modelBlock`, the
		// rule the router and every translation action read too).
		const blockOf = (modelRef: ModelRef) =>
			modelBlock(
				modelRef,
				capability.value,
				{
					llm: !!store.state.settings.translateLlm,
					cpu: !!store.state.settings.translateCpu,
					nllb: !!store.state.settings.translateNllb,
				},
				enabled
			);

		// Why a GPU model cannot be chosen here: the device binds too little
		// for it, or cannot run a GPU model at all, on a device the probe
		// placed on the gpu tier -- where choosing it would quietly run the
		// default instead (models.ts `llmChoice`). Not while probing, not
		// for the switch (choosing ahead of switching on is fine), and not
		// on a device without a GPU model at all, where the choice only
		// keys the route table.
		const llmUnfit = (choice: ModelRef) => {
			if (capability.value?.tier !== "gpu") {
				return null;
			}

			const block = modelBlock(choice, capability.value, {llm: true, cpu: true, nllb: true});

			return block && (block.kind === "buffer" || block.kind === "device") ? block : null;
		};

		const unfitLlms = computed(() => llmChoices.filter((choice) => !!llmUnfit(choice)));

		// `runs`, `off` (switched off above: it would run) or `cannot`.
		const runsState = (modelRef: ModelRef) => {
			const block = blockOf(modelRef);

			return !block ? "runs" : block.kind === "off" ? "off" : "cannot";
		};

		const runsLabel = (modelRef: ModelRef) => {
			const block = blockOf(modelRef);

			if (!block) {
				return t("translate.model.runsHere");
			}

			if (block.kind === "off") {
				return t("translate.model.switchedOff");
			}

			return block.kind === "probing"
				? t("translate.why.probing")
				: t("translate.model.cantRun");
		};

		// The small-buffer build this device runs in the model's place, when
		// it does: on a GPU tier that binds too little for the model itself.
		const smallBuild = (modelRef: ModelRef) =>
			capability.value?.tier === "gpu"
				? smallBufferBuildFor(modelRef, capability.value.maxBufferBytes)
				: null;

		// The reason under "Can't run on this device"; none for the others.
		const whyLabel = (modelRef: ModelRef) => {
			const block = blockOf(modelRef);

			return block && block.kind !== "off" && block.kind !== "probing"
				? translateWhyText(block)
				: "";
		};

		// A switched-off model can still be downloaded ahead of use; one the
		// device cannot run, or before the probe has answered, cannot.
		const allowed = (modelRef: ModelRef) => {
			const block = blockOf(modelRef);

			return !block || block.kind === "off";
		};

		// The ref comes off a reactive `v-for` row (store.state.translation.models);
		// the worker protocol structured-clones every message, which rejects a
		// Vue reactive Proxy, so send the raw object underneath it.
		const download = (modelRef: ModelRef) => {
			service.download(toRaw(modelRef)).catch(() => {
				// the view carries the error; nothing else to do
			});
		};

		// What the polite region says: a download (or a load of one already
		// here) that has just finished or failed, by model name.
		const announcement = ref("");
		const lastStatus = new Map<string, ModelView["status"]>();

		watch(
			models,
			(views) => {
				for (const view of views) {
					const before = lastStatus.get(view.ref.id);

					lastStatus.set(view.ref.id, view.status);

					if (before === "downloading" && view.status !== "downloading") {
						announcement.value = t("translate.model.announce", {
							model: modelLabel(view.ref),
							state: stateLabel(view),
						});
					}
				}
			},
			{deep: true, immediate: true}
		);

		const remove = (modelRef: ModelRef) => {
			service.deleteModel(toRaw(modelRef)).catch((e: unknown) => {
				loadError.value = errorMessage(e);
			});
		};

		return {
			t,
			modelLabel,
			reasonText,
			runsState,
			runsLabel,
			llmUnfit,
			unfitLlms,
			whyText: translateWhyText,
			whyLabel,
			smallBuild,
			testLimitKey: GPU_TEST_LIMIT_KEY,
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
			announcement,
		};
	},
});
</script>
