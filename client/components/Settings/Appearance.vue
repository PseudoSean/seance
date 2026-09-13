<template>
	<div>
		<h2>{{ t("settings.appearance.messagesHeading") }}</h2>
		<div>
			<label class="opt">
				<input :checked="store.state.settings.motd" type="checkbox" name="motd" />
				{{ t("settings.appearance.showMotd") }}
				<abbr :title="motdTitle">MOTD</abbr>
			</label>
		</div>
		<div>
			<label class="opt">
				<input :checked="store.state.settings.markdown" type="checkbox" name="markdown" />
				{{ t("settings.appearance.markdown") }}
			</label>
		</div>
		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.showSeconds"
					type="checkbox"
					name="showSeconds"
				/>
				{{ t("settings.appearance.showSeconds") }}
			</label>
		</div>
		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.use12hClock"
					type="checkbox"
					name="use12hClock"
				/>
				{{ t("settings.appearance.use12hClock") }}
			</label>
		</div>
		<h2 id="label-media-previews">{{ t("settings.appearance.mediaHeading") }}</h2>
		<div role="group" aria-labelledby="label-media-previews">
			<label class="opt">
				<input :checked="store.state.settings.media" type="checkbox" name="media" />
				{{ t("settings.appearance.media") }}
			</label>
			<div
				role="group"
				:aria-label="mediaRevealGroupLabel"
				:class="['media-reveal-options', {disabled: !store.state.settings.media}]"
			>
				<label class="opt">
					<input
						:checked="store.state.settings.mediaReveal === 'click'"
						:disabled="!store.state.settings.media"
						type="radio"
						name="mediaReveal"
						value="click"
					/>
					{{ t("settings.appearance.mediaClick") }}
				</label>
				<label class="opt">
					<input
						:checked="store.state.settings.mediaReveal === 'always'"
						:disabled="!store.state.settings.media"
						type="radio"
						name="mediaReveal"
						value="always"
					/>
					{{ t("settings.appearance.mediaAlways") }}
				</label>
			</div>
			<div
				v-if="store.state.settings.media && store.state.settings.mediaReveal === 'click'"
				class="trusted-hosts"
			>
				<div class="trusted-hosts-head">
					<span class="trusted-hosts-title">{{
						t("settings.appearance.trustedHeading")
					}}</span>
					<button
						v-if="trustedCount > 0"
						type="button"
						class="trusted-hosts-clear"
						@click="clearTrusted()"
					>
						{{ t("settings.appearance.trustedClear") }}
					</button>
				</div>
				<p class="trusted-hosts-help">
					{{ t("settings.appearance.trustedHelpA") }}
					<em>{{ t("settings.appearance.trustedButtonName") }}</em>
					{{ t("settings.appearance.trustedHelpB") }}
				</p>
				<template v-for="group in trustedGroups" :key="group.kind">
					<div v-if="group.entries.length > 0" class="trusted-group">
						<span class="trusted-group-title">{{ group.title }}</span>
						<ul class="trusted-host-list">
							<li
								v-for="entry in group.entries"
								:key="entry.key"
								:class="['trusted-host', 'trusted-' + group.kind]"
							>
								<span class="trusted-host-name">{{ entry.name }}</span>
								<span v-if="entry.network" class="trusted-host-network">{{
									entry.network
								}}</span>
								<button
									type="button"
									class="trusted-host-remove"
									:aria-label="untrustLabel(group.kind, entry.name)"
									:title="untrustLabel(group.kind, entry.name)"
									@click="untrust(group.kind, entry.key)"
								></button>
							</li>
						</ul>
					</div>
				</template>
				<p v-if="trustedCount === 0" class="trusted-hosts-empty">
					{{ t("settings.appearance.trustedEmpty") }}
				</p>
			</div>
		</div>
		<h2 id="label-status-messages">
			{{ t("settings.appearance.statusHeading") }}
			<span class="tooltipped tooltipped-n tooltipped-no-delay" :aria-label="statusHelpLabel">
				<button class="extra-help" />
			</span>
		</h2>
		<div role="group" aria-labelledby="label-status-messages">
			<label class="opt">
				<input
					:checked="store.state.settings.statusMessages === 'shown'"
					type="radio"
					name="statusMessages"
					value="shown"
				/>
				{{ t("settings.appearance.statusShown") }}
			</label>
			<label class="opt">
				<input
					:checked="store.state.settings.statusMessages === 'condensed'"
					type="radio"
					name="statusMessages"
					value="condensed"
				/>
				{{ t("settings.appearance.statusCondensed") }}
			</label>
			<label class="opt">
				<input
					:checked="store.state.settings.statusMessages === 'hidden'"
					type="radio"
					name="statusMessages"
					value="hidden"
				/>
				{{ t("settings.appearance.statusHidden") }}
			</label>
		</div>
		<h2>{{ t("settings.appearance.visualAids") }}</h2>
		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.coloredNicks"
					type="checkbox"
					name="coloredNicks"
				/>
				{{ t("settings.appearance.coloredNicks") }}
			</label>
			<label class="opt">
				<input
					:checked="store.state.settings.autocomplete"
					type="checkbox"
					name="autocomplete"
				/>
				{{ t("settings.appearance.autocomplete") }}
			</label>
		</div>
		<div>
			<label class="opt">
				<label for="nickPostfix" class="opt">
					{{ t("settings.appearance.nickPostfix") }}
					<span
						class="tooltipped tooltipped-n tooltipped-no-delay"
						:aria-label="nickPostfixHelp"
					>
						<button class="extra-help" />
					</span>
				</label>
				<input
					id="nickPostfix"
					dir="auto"
					:value="store.state.settings.nickPostfix"
					type="text"
					name="nickPostfix"
					class="input"
					:placeholder="nickPostfixPlaceholder"
				/>
			</label>
		</div>

		<h2 id="label-font-size">{{ t("settings.appearance.fontSizeHeading") }}</h2>
		<div role="group" aria-labelledby="label-font-size" class="font-size-setting">
			<!-- No `name`: the window's generic @change handler would store the
			     raw slider index. While the slider moves only the sample below
			     follows it; the setting is applied when it is let go. -->
			<span class="font-size-slider">
				<input
					type="range"
					min="0"
					:max="fontSizes.length - 1"
					step="1"
					list="font-size-stops"
					:value="shownIndex"
					:aria-valuetext="shownLabel"
					:aria-label="fontSizeAriaLabel"
					@input="onFontSizeInput"
					@change="onFontSizeChange"
				/>
			</span>
			<datalist id="font-size-stops">
				<option
					v-for="(size, index) in fontSizes"
					:key="size"
					:value="index"
					:label="fontSizeLabels[size]"
				></option>
			</datalist>
			<span class="font-size-value" aria-hidden="true">{{ shownLabel }}</span>
		</div>
		<div class="font-size-sample" :style="{fontSize: sampleFontSize}" aria-hidden="true">
			<div v-for="line in sampleLines" :key="line.from" class="line">
				<span class="time">{{ line.time }}</span>
				<span class="from user" :class="line.color">{{ line.from }}</span>
				<span class="text">{{ line.text }}</span>
			</div>
		</div>

		<h2>{{ t("settings.appearance.theme") }}</h2>
		<div>
			<label for="theme-select" class="sr-only">{{ t("settings.appearance.theme") }}</label>
			<select
				id="theme-select"
				:value="store.state.settings.theme"
				name="theme"
				class="input"
			>
				<option
					v-for="theme in store.state.serverConfiguration?.themes"
					:key="theme.name"
					:value="theme.name"
				>
					{{ theme.displayName }}
				</option>
			</select>
		</div>

		<h2>{{ t("settings.locale") }}</h2>
		<div>
			<label for="settings-locale" class="sr-only">{{ t("settings.locale") }}</label>
			<LanguageSelect
				id="settings-locale"
				:model-value="store.state.settings.locale"
				@change="setLocale"
			/>
		</div>

		<div>
			<h2>{{ t("settings.appearance.customStylesheet") }}</h2>
			<label for="user-specified-css-input" class="sr-only">
				{{ t("settings.appearance.customStylesheetHelp") }}
			</label>
			<textarea
				id="user-specified-css-input"
				dir="auto"
				:value="store.state.settings.userStyles"
				class="input"
				name="userStyles"
				:placeholder="customStylesheetPlaceholder"
			/>
		</div>
	</div>
</template>

<style>
textarea#user-specified-css-input {
	height: 100px;
}

.font-size-setting {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
}

/*
 * The one deliberate px island in the chrome: the slider is the control that
 * changes the scale, so it must not change size with it. Nothing else moves
 * while it is dragged either — only the sample below renders the new step,
 * and the page takes the scale when the slider is let go.
 */
.font-size-setting .font-size-slider {
	flex: 0 0 auto;
	width: 256px;
	height: 24px;
}

.font-size-setting input[type="range"] {
	display: block;
	width: 100%;
	height: 100%;
	margin: 0;
	font-size: 16px;
}

.font-size-setting .font-size-value {
	min-width: 90px;
	color: var(--body-color-muted);
}

/* A few lines of chat at the step under the slider. Everything in it is em,
 * so the inline font-size — the step's percentage of the browser default,
 * whatever the page is at — is the whole preview. */
.font-size-sample {
	margin-top: 10px;
	padding: 0.4em 0.6em;
	border: 1px solid var(--body-color-muted);
	border-radius: 0.3em;
	background: var(--window-bg-color);
	line-height: 1.4;
	overflow: hidden;
}

.font-size-sample .line {
	display: flex;
	align-items: flex-start;
}

.font-size-sample .time {
	flex: 0 0 auto;
	margin-inline-end: 0.6em;
	color: var(--body-color-muted);
	font-variant-numeric: tabular-nums;
}

.font-size-sample .from {
	flex: 0 0 auto;
	margin-inline-end: 0.6em;
	font-weight: bold;
}

.font-size-sample .text {
	flex: 1 1 auto;
	min-width: 0;
	word-break: break-word;
}
</style>

<script lang="ts">
import {computed, defineComponent, ref} from "vue";
import {useStore} from "../../js/store";
import {useI18n} from "../../js/i18n";
import LanguageSelect from "../LanguageSelect.vue";
import {
	fontSizeLabels,
	fontSizeScale,
	fontSizes,
	normalizeFontSize,
	type FontSize,
} from "../../js/helpers/fontSize";
import {
	clearTrusted,
	splitKey,
	trustedMedia,
	untrust,
	type TrustKind,
} from "../../js/helpers/mediaTrust";

type TrustedEntry = {key: string; name: string; network: string};

export default defineComponent({
	name: "AppearanceSettings",
	components: {LanguageSelect},
	setup() {
		const store = useStore();
		const {t} = useI18n();

		const motdTitle = computed(() => t("settings.appearance.motdTitle"));
		const mediaRevealGroupLabel = computed(() => t("settings.appearance.mediaRevealGroup"));
		const statusHelpLabel = computed(() => t("settings.appearance.statusHelp"));
		const nickPostfixHelp = computed(() => t("settings.appearance.nickPostfixHelp"));
		const nickPostfixPlaceholder = computed(() =>
			t("settings.appearance.nickPostfixPlaceholder")
		);
		const fontSizeAriaLabel = computed(() => t("settings.appearance.fontSizeAria"));
		const customStylesheetPlaceholder = computed(() =>
			t("settings.appearance.customStylesheetPlaceholder")
		);

		/** Remove-button label of the always-shown list: "in" a channel,
		 * "from" a site or a person. */
		const untrustLabel = (kind: TrustKind, name: string) =>
			kind === "channel"
				? t("settings.appearance.untrustIn", {name})
				: t("settings.appearance.untrustFrom", {name});

		const setLocale = (tag: string) =>
			void store.dispatch("settings/update", {name: "locale", value: tag});

		// Channel and account keys carry the network uuid; show its name.
		const networkName = (uuid: string) =>
			store.getters.findNetwork(uuid)?.name ?? uuid.slice(0, 8);

		const entriesOf = (kind: TrustKind): TrustedEntry[] =>
			trustedMedia(kind).map((key) => {
				if (kind === "host") {
					return {key, name: key, network: ""};
				}

				const {network, name} = splitKey(key);
				return {key, name, network: network ? networkName(network) : ""};
			});

		const trustedGroups = computed(() => [
			{
				kind: "host" as TrustKind,
				title: t("settings.appearance.trustedSites"),
				entries: entriesOf("host"),
			},
			{
				kind: "account" as TrustKind,
				title: t("settings.appearance.trustedPeople"),
				entries: entriesOf("account"),
			},
			{
				kind: "channel" as TrustKind,
				title: t("settings.appearance.trustedChannels"),
				entries: entriesOf("channel"),
			},
		]);
		const trustedCount = computed(() =>
			trustedGroups.value.reduce((n, g) => n + g.entries.length, 0)
		);

		const fontSize = computed(() => normalizeFontSize(store.state.settings.fontSize));

		// The step under the slider while it is being dragged. Applying every
		// step live re-laid out the whole page (rem chrome) under the pointer
		// and moved the slider with it, so a drag only renders the sample
		// below; `change` — the pointer let go, or a keyboard step, which
		// fires both events — applies it and the page follows in one move.
		const draggedTo = ref<FontSize | null>(null);
		const shown = computed(() => draggedTo.value ?? fontSize.value);
		const shownIndex = computed(() => fontSizes.indexOf(shown.value));
		const shownLabel = computed(() => fontSizeLabels[shown.value]);
		// The sample at the shown step: its percentage of the browser default,
		// through whatever the page is at now (1rem = the applied step).
		const sampleFontSize = computed(
			() => `${fontSizeScale[shown.value] / fontSizeScale[fontSize.value]}rem`
		);
		const sampleLines = [
			{
				time: "12:34",
				from: "grandma",
				color: "color-4",
				text: "Can you read this without your glasses?",
			},
			{
				time: "12:35",
				from: "you",
				color: "color-10",
				text: "Yes! Slide it until this is comfortable.",
			},
			{
				time: "12:35",
				from: "grandma",
				color: "color-4",
				text: "The ends are meant to be too small and too big.",
			},
		];

		const stepOf = (event: Event) =>
			fontSizes[Number((event.target as HTMLInputElement).value)];

		const onFontSizeInput = (event: Event) => {
			draggedTo.value = stepOf(event) ?? null;
		};

		const onFontSizeChange = (event: Event) => {
			const value = stepOf(event);
			draggedTo.value = null;

			if (value) {
				void store.dispatch("settings/update", {name: "fontSize", value, sync: true});
			}
		};

		return {
			store,
			t,
			motdTitle,
			mediaRevealGroupLabel,
			statusHelpLabel,
			nickPostfixHelp,
			nickPostfixPlaceholder,
			fontSizeAriaLabel,
			customStylesheetPlaceholder,
			untrustLabel,
			setLocale,
			trustedGroups,
			trustedCount,
			untrust,
			clearTrusted,
			fontSizes,
			fontSizeLabels,
			shownIndex,
			shownLabel,
			sampleFontSize,
			sampleLines,
			onFontSizeInput,
			onFontSizeChange,
		};
	},
});
</script>
