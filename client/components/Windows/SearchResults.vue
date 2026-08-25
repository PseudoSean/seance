<template>
	<div id="chat-container" class="window">
		<div id="chat">
			<div
				class="chat-view"
				data-type="search-results"
				aria-label="Search results"
				role="tabpanel"
			>
				<div class="header">
					<SidebarToggle />
					<span class="title">
						Search
						<template v-if="channel">
							in <span class="channel-name">{{ channel.name }}</span>
						</template>
					</span>
					<span class="topic">{{ route.query.q }}</span>
					<button
						class="close"
						aria-label="Close search window"
						title="Close search window"
						@click="closeSearch"
					/>
				</div>
				<div class="chat-content">
					<div class="chat" tabindex="-1">
						<div class="search-status">
							Search is not available yet. Message history lives only in this browser
							session for now.
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<style>
.channel-name {
	font-weight: 700;
}
</style>

<script lang="ts">
import eventbus from "../../js/eventbus";
import SidebarToggle from "../SidebarToggle.vue";
import {computed, defineComponent, onMounted, onUnmounted} from "vue";
import {useStore} from "../../js/store";
import {useRoute} from "vue-router";
import {switchToChannel, navigate} from "../../js/router";

export default defineComponent({
	name: "SearchResults",
	components: {
		SidebarToggle,
	},
	setup() {
		const store = useStore();
		const route = useRoute();

		const chan = computed(() => {
			const chanId = parseInt(String(route.params.id || ""), 10);
			return store.getters.findChannel(chanId);
		});

		const channel = computed(() => chan.value?.channel ?? null);

		const closeSearch = () => {
			if (channel.value) {
				switchToChannel(channel.value);
			} else {
				void navigate("Connect");
			}
		};

		onMounted(() => {
			if (chan.value) {
				store.commit("activeChannel", chan.value);
			}

			eventbus.on("escapekey", closeSearch);
		});

		onUnmounted(() => {
			eventbus.off("escapekey", closeSearch);
		});

		return {
			channel,
			route,
			closeSearch,
		};
	},
});
</script>
