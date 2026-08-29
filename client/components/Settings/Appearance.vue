<template>
	<div>
		<h2>Messages</h2>
		<div>
			<label class="opt">
				<input :checked="store.state.settings.motd" type="checkbox" name="motd" />
				Show <abbr title="Message Of The Day">MOTD</abbr>
			</label>
		</div>
		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.showSeconds"
					type="checkbox"
					name="showSeconds"
				/>
				Include seconds in timestamp
			</label>
		</div>
		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.use12hClock"
					type="checkbox"
					name="use12hClock"
				/>
				Use 12-hour timestamps
			</label>
		</div>
		<h2 id="label-media-previews">Media previews</h2>
		<div role="group" aria-labelledby="label-media-previews">
			<label class="opt">
				<input :checked="store.state.settings.media" type="checkbox" name="media" />
				Preview images, video and audio links inline
			</label>
			<div
				role="group"
				aria-label="When to load previews"
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
					Click to reveal — nothing is fetched from the media site until you ask to see it
				</label>
				<label class="opt">
					<input
						:checked="store.state.settings.mediaReveal === 'always'"
						:disabled="!store.state.settings.media"
						type="radio"
						name="mediaReveal"
						value="always"
					/>
					Show automatically — the media site sees your address as soon as a link appears
				</label>
			</div>
			<div
				v-if="store.state.settings.media && store.state.settings.mediaReveal === 'click'"
				class="trusted-hosts"
			>
				<div class="trusted-hosts-head">
					<span class="trusted-hosts-title">Always shown</span>
					<button
						v-if="trustedCount > 0"
						type="button"
						class="trusted-hosts-clear"
						@click="clearTrusted()"
					>
						Clear all
					</button>
				</div>
				<p class="trusted-hosts-help">
					Media in these scopes loads without asking. Add one with
					<em>Always show</em> on any preview.
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
									:aria-label="`Stop always showing ${group.verb} ${entry.name}`"
									:title="`Stop always showing ${group.verb} ${entry.name}`"
									@click="untrust(group.kind, entry.key)"
								></button>
							</li>
						</ul>
					</div>
				</template>
				<p v-if="trustedCount === 0" class="trusted-hosts-empty">Nothing yet.</p>
			</div>
		</div>
		<h2 id="label-status-messages">
			Status messages
			<span
				class="tooltipped tooltipped-n tooltipped-no-delay"
				aria-label="Joins, parts, quits, kicks, nick changes, and mode changes"
			>
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
				Show all status messages individually
			</label>
			<label class="opt">
				<input
					:checked="store.state.settings.statusMessages === 'condensed'"
					type="radio"
					name="statusMessages"
					value="condensed"
				/>
				Condense status messages together
			</label>
			<label class="opt">
				<input
					:checked="store.state.settings.statusMessages === 'hidden'"
					type="radio"
					name="statusMessages"
					value="hidden"
				/>
				Hide all status messages
			</label>
		</div>
		<h2>Visual Aids</h2>
		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.coloredNicks"
					type="checkbox"
					name="coloredNicks"
				/>
				Enable colored nicknames
			</label>
			<label class="opt">
				<input
					:checked="store.state.settings.autocomplete"
					type="checkbox"
					name="autocomplete"
				/>
				Enable autocomplete
			</label>
		</div>
		<div>
			<label class="opt">
				<label for="nickPostfix" class="opt">
					Nick autocomplete postfix
					<span
						class="tooltipped tooltipped-n tooltipped-no-delay"
						aria-label="Nick autocomplete postfix (for example a comma)"
					>
						<button class="extra-help" />
					</span>
				</label>
				<input
					id="nickPostfix"
					:value="store.state.settings.nickPostfix"
					type="text"
					name="nickPostfix"
					class="input"
					placeholder="Nick autocomplete postfix (e.g. ', ')"
				/>
			</label>
		</div>

		<h2>Theme</h2>
		<div>
			<label for="theme-select" class="sr-only">Theme</label>
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

		<div>
			<h2>Custom Stylesheet</h2>
			<label for="user-specified-css-input" class="sr-only">
				Custom stylesheet. You can override any style with CSS here.
			</label>
			<textarea
				id="user-specified-css-input"
				:value="store.state.settings.userStyles"
				class="input"
				name="userStyles"
				placeholder="/* You can override any style with CSS here */"
			/>
		</div>
	</div>
</template>

<style>
textarea#user-specified-css-input {
	height: 100px;
}
</style>

<script lang="ts">
import {computed, defineComponent} from "vue";
import {useStore} from "../../js/store";
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
	setup() {
		const store = useStore();

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
			{kind: "host" as TrustKind, title: "Sites", verb: "from", entries: entriesOf("host")},
			{
				kind: "account" as TrustKind,
				title: "People",
				verb: "from",
				entries: entriesOf("account"),
			},
			{
				kind: "channel" as TrustKind,
				title: "Channels",
				verb: "in",
				entries: entriesOf("channel"),
			},
		]);
		const trustedCount = computed(() =>
			trustedGroups.value.reduce((n, g) => n + g.entries.length, 0)
		);

		return {
			store,
			trustedGroups,
			trustedCount,
			untrust,
			clearTrusted,
		};
	},
});
</script>
