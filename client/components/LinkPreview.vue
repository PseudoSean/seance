<template>
	<div v-if="link.shown" v-show="link.sourceLoaded" ref="container" class="preview" dir="ltr">
		<div ref="content" :class="['toggle-content', 'toggle-type-' + link.type]">
			<template v-if="link.type === 'image'">
				<a
					:href="link.link"
					class="toggle-thumbnail"
					target="_blank"
					rel="noopener"
					@click="onThumbnailClick"
				>
					<img
						v-show="link.sourceLoaded"
						:src="link.thumb"
						decoding="async"
						loading="lazy"
						alt=""
						@load="onPreviewReady"
						@error="onPreviewError"
						@abort="onPreviewError"
					/>
				</a>
			</template>
			<template v-else-if="link.type === 'video'">
				<video
					v-show="link.sourceLoaded"
					preload="metadata"
					controls
					@canplay="onPreviewReady"
					@error="onPreviewError"
				>
					<source :src="link.media" :type="link.mediaType" />
				</video>
			</template>
			<template v-else-if="link.type === 'audio'">
				<audio
					v-show="link.sourceLoaded"
					controls
					preload="metadata"
					@canplay="onPreviewReady"
					@error="onPreviewError"
				>
					<source :src="link.media" :type="link.mediaType" />
				</audio>
			</template>
		</div>
	</div>
</template>

<script lang="ts">
import {defineComponent, inject, onUnmounted, PropType, ref, watch} from "vue";
import {onBeforeRouteUpdate} from "vue-router";
import {useStore} from "../js/store";
import type {ClientChan, ClientLinkPreview} from "../js/types";
import {imageViewerKey} from "./App.vue";

// Renders one preview built by `client/js/helpers/mediaPreview.ts`. Only
// direct media (image/video/audio) is supported: there is no server to fetch
// page metadata, so the old "link" (title/description/favicon), "loading" and
// "error" preview types no longer exist. The CSS classes (`preview`,
// `toggle-content`, `toggle-type-*`, `toggle-thumbnail`) are unchanged so
// themes keep working.
export default defineComponent({
	name: "LinkPreview",
	props: {
		link: {
			type: Object as PropType<ClientLinkPreview>,
			required: true,
		},
		keepScrollPosition: {
			type: Function as PropType<() => void>,
			required: true,
		},
		channel: {type: Object as PropType<ClientChan>, required: true},
	},
	setup(props) {
		const store = useStore();
		const imageViewer = inject(imageViewerKey);

		onBeforeRouteUpdate((to, from, next) => {
			// cancel the navigation if the user is trying to close the image viewer
			if (imageViewer?.value?.link) {
				imageViewer.value.closeViewer();
				return next(false);
			}

			next();
		});

		const content = ref<HTMLDivElement | null>(null);
		const container = ref<HTMLDivElement | null>(null);

		const onPreviewReady = () => {
			props.link.sourceLoaded = true;

			props.keepScrollPosition();
		};

		const onPreviewError = () => {
			// The browser could not load or decode the media: leave the preview
			// hidden (the link itself is still in the message text).
			props.link.sourceLoaded = false;
		};

		const onThumbnailClick = (e: MouseEvent) => {
			e.preventDefault();

			if (!imageViewer?.value) {
				return;
			}

			imageViewer.value.channel = props.channel;
			imageViewer.value.link = props.link;
		};

		const updateShownState = () => {
			// User has manually toggled the preview, do not apply default
			if (props.link.shown !== null && props.link.shown !== undefined) {
				return;
			}

			props.link.shown = store.state.settings.media;
		};

		updateShownState();

		watch(
			() => props.link.type,
			() => {
				updateShownState();
			}
		);

		onUnmounted(() => {
			// Let this preview go through load/canplay events again,
			// Otherwise the browser can cause a resize on video elements
			props.link.sourceLoaded = false;
		});

		return {
			onThumbnailClick,
			onPreviewReady,
			onPreviewError,
			content,
			container,
		};
	},
});
</script>
