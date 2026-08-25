<template>
	<div id="changelog" class="window" aria-label="Changelog">
		<div class="header">
			<SidebarToggle />
		</div>
		<div class="container">
			<router-link id="back-to-help" to="/help">« Help</router-link>

			<h1 class="title">Release notes for {{ version }}</h1>

			<p>
				Release notes are not bundled with this client-only build yet. This build is based
				on The Lounge {{ version }}.
			</p>
			<p>
				<a
					:href="`https://github.com/thelounge/thelounge/releases/tag/v${version}`"
					target="_blank"
					rel="noopener"
					>View the upstream release notes for this version on GitHub</a
				>
			</p>
		</div>
	</div>
</template>

<script lang="ts">
import {defineComponent} from "vue";
import {useStore} from "../../js/store";
import SidebarToggle from "../SidebarToggle.vue";

export default defineComponent({
	name: "Changelog",
	components: {
		SidebarToggle,
	},
	setup() {
		const store = useStore();
		const version = store.state.serverConfiguration?.version || "";

		return {
			version,
		};
	},
});
</script>
