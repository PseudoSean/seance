<template>
	<div id="changelog" class="window" :aria-label="ariaLabel">
		<div class="header">
			<SidebarToggle />
		</div>
		<div class="container">
			<router-link id="back-to-help" to="/help">{{
				t("windows.changelog.back")
			}}</router-link>

			<h1 class="title">{{ t("windows.changelog.title", {version: build.release}) }}</h1>

			<p v-if="pastRelease">
				{{ t("windows.changelog.pastRelease") }}
				<a :href="source.commit" target="_blank" rel="noopener"
					>{{ t("windows.changelog.commitLink") }} <code>{{ build.gitCommit }}</code></a
				>{{ t("windows.changelog.pastReleaseAfter", {version: build.release}) }}
				<a :href="source.sinceRelease" target="_blank" rel="noopener">{{
					t("windows.changelog.sinceReleaseLink")
				}}</a
				>.
			</p>
			<p>
				{{ t("windows.changelog.notBundled") }}
				<a :href="source.releaseNotes" target="_blank" rel="noopener">{{
					t("windows.changelog.readNotesLink", {version: build.release})
				}}</a>
				{{ t("windows.changelog.or") }}
				<a :href="source.releases" target="_blank" rel="noopener">{{
					t("windows.changelog.allReleasesLink")
				}}</a
				>.
			</p>
		</div>
	</div>
</template>

<script lang="ts">
import {computed, defineComponent} from "vue";
import {useStore} from "../../js/store";
import {useI18n} from "../../js/i18n";
import {buildIdentityOf, isPastRelease, sourceLinks} from "../../js/helpers/sourceLinks";
import SidebarToggle from "../SidebarToggle.vue";

export default defineComponent({
	name: "Changelog",
	components: {
		SidebarToggle,
	},
	setup() {
		const store = useStore();
		const {t} = useI18n();
		const build = computed(() => buildIdentityOf(store.state.serverConfiguration));
		const pastRelease = computed(() => isPastRelease(build.value));
		const source = computed(() => sourceLinks(store.state.branding.links?.source, build.value));
		const ariaLabel = computed(() => t("windows.changelog.aria"));

		return {
			t,
			ariaLabel,
			build,
			pastRelease,
			source,
		};
	},
});
</script>
