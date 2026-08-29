<template>
	<div v-if="link.shown" ref="container" class="preview" dir="ltr">
		<div
			ref="content"
			:class="[
				'toggle-content',
				'toggle-type-' + link.type,
				{'media-revealed': revealed && link.sourceLoaded},
			]"
		>
			<!-- The veil: what stands in for the media until the reader asks
			for it. It has a fixed height so scrollback does not jump, and it
			doubles as the loading and error state once revealed. -->
			<div
				v-if="!revealed || !link.sourceLoaded"
				:class="['media-veil', {loading: revealed, failed}]"
			>
				<button
					type="button"
					class="media-veil-main"
					:aria-label="veilLabel"
					:disabled="revealed"
					@click="reveal"
				>
					<span class="media-veil-icon" :data-kind="link.type" aria-hidden="true"></span>
					<span class="media-veil-text">
						<span class="media-veil-title">{{ veilTitle }}</span>
						<span class="media-veil-hint">{{ veilHint }}</span>
					</span>
				</button>
				<button
					v-if="hasScopes"
					type="button"
					class="media-veil-trust"
					:title="trustTitle"
					aria-haspopup="menu"
					@click="openTrustMenu"
				>
					{{ trustedKinds.length > 0 ? "Always shown" : "Always show" }}
					<span class="media-veil-caret" aria-hidden="true"></span>
				</button>
			</div>
			<div v-if="revealed" v-show="link.sourceLoaded" class="media-frame">
				<template v-if="link.type === 'image'">
					<a
						:href="link.link"
						class="toggle-thumbnail"
						target="_blank"
						rel="noopener noreferrer"
						@click="onThumbnailClick"
					>
						<!-- No loading="lazy" here: v-show hides the element until it
						has loaded, and a lazy image with no box never becomes
						eligible to load, so @load would never fire. -->
						<img
							v-show="link.sourceLoaded"
							:src="link.thumb"
							decoding="async"
							referrerpolicy="no-referrer"
							alt=""
							@load="onPreviewReady"
							@error="onPreviewError"
							@abort="onPreviewError"
						/>
					</a>
				</template>
				<!-- Media elements with <source> children fire `error` on the
				last <source>, not on themselves, hence the listener on both. -->
				<template v-else-if="link.type === 'video'">
					<video
						v-show="link.sourceLoaded"
						preload="metadata"
						controls
						referrerpolicy="no-referrer"
						@canplay="onPreviewReady"
						@error="onPreviewError"
					>
						<source :src="link.media" :type="link.mediaType" @error="onPreviewError" />
					</video>
				</template>
				<template v-else-if="link.type === 'audio'">
					<audio
						v-show="link.sourceLoaded"
						controls
						preload="metadata"
						referrerpolicy="no-referrer"
						@canplay="onPreviewReady"
						@error="onPreviewError"
					>
						<source :src="link.media" :type="link.mediaType" @error="onPreviewError" />
					</audio>
				</template>
				<div class="media-tools" role="group" aria-label="Preview actions">
					<button
						type="button"
						class="media-tool media-tool-hide"
						title="Hide this preview"
						aria-label="Hide this preview"
						@click="hide"
					></button>
					<button
						v-if="hasScopes"
						type="button"
						:class="[
							'media-tool',
							'media-tool-trust',
							{active: trustedKinds.length > 0},
						]"
						:title="trustTitle"
						:aria-label="trustTitle"
						aria-haspopup="menu"
						@click="openTrustMenu"
					></button>
					<a
						class="media-tool media-tool-open"
						:href="link.link"
						target="_blank"
						rel="noopener noreferrer"
						title="Open in a new tab"
						aria-label="Open in a new tab"
					></a>
				</div>
			</div>
		</div>
	</div>
</template>

<script lang="ts">
import {computed, defineComponent, inject, onUnmounted, PropType, ref, watch} from "vue";
import {onBeforeRouteUpdate} from "vue-router";
import {useStore} from "../js/store";
import eventbus from "../js/eventbus";
import type {ClientChan, ClientLinkPreview} from "../js/types";
import {
	isPreviewRevealed,
	mediaFileName,
	mediaHost,
	trustedScopesOf,
} from "../js/helpers/mediaTrust";
import {mediaScopesOf, mediaTrustMenu} from "../js/helpers/mediaTrustMenu";
import {imageViewerKey} from "./App.vue";

// Renders one preview built by `client/js/helpers/mediaPreview.ts`. Only
// direct media (image/video/audio) is supported: there is no server to fetch
// page metadata, so the old "link" (title/description/favicon), "loading" and
// "error" preview types no longer exist. The CSS classes (`preview`,
// `toggle-content`, `toggle-type-*`, `toggle-thumbnail`) are unchanged so
// themes keep working.
//
// Media is click-to-reveal by default (`mediaReveal` setting): nothing is
// fetched from the media host until the reader chooses to see it, once for
// this preview or always for its host, its channel or its sender's account
// (`helpers/mediaTrust.ts`, menu in `helpers/mediaTrustMenu.ts`). Revealed
// media carries a small toolbar to hide it again or change that trust.
const kindLabel: Record<string, string> = {
	image: "image",
	video: "video",
	audio: "audio",
};

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
		const failed = ref(false);

		const host = computed(() => mediaHost(props.link.link));
		const fileName = computed(() => mediaFileName(props.link.link));
		const hasScopes = computed(() => mediaScopesOf(props.link).length > 0);
		const trustedKinds = computed(() => trustedScopesOf(props.link));
		const revealed = computed(() =>
			isPreviewRevealed(props.link, store.state.settings.mediaReveal === "always")
		);

		const kind = computed(() => kindLabel[props.link.type] ?? "media");
		const veilTitle = computed(() => {
			if (failed.value) {
				return `Couldn't load this ${kind.value}`;
			}

			if (revealed.value) {
				return `Loading ${kind.value}…`;
			}

			const noun = kind.value.charAt(0).toUpperCase() + kind.value.slice(1);
			return host.value ? `${noun} from ${host.value}` : noun;
		});
		const veilHint = computed(() => {
			if (failed.value) {
				return "Click to try again";
			}

			if (revealed.value) {
				return fileName.value;
			}

			return fileName.value ? `${fileName.value} · Click to show` : "Click to show";
		});
		const veilLabel = computed(() =>
			host.value ? `Show ${kind.value} from ${host.value}` : `Show ${kind.value}`
		);
		const trustTitle = computed(() => {
			const shown = mediaScopesOf(props.link)
				.filter((s) => trustedKinds.value.includes(s.kind))
				.map((s) => s.label);

			return shown.length > 0
				? `Always shown ${shown.join(", ")} — change`
				: "Always show media from this site, this person or in this channel";
		});

		const onPreviewReady = () => {
			failed.value = false;
			props.link.sourceLoaded = true;

			props.keepScrollPosition();
		};

		const onPreviewError = () => {
			// The browser could not load or decode the media: fall back to the
			// veil in its error state (the link itself is still in the text)
			// and stop a trusted scope from retrying on every re-render.
			props.link.sourceLoaded = false;
			props.link.revealed = false;
			failed.value = true;
		};

		const reveal = () => {
			failed.value = false;
			props.link.revealed = true;
		};

		const hide = () => {
			props.link.revealed = false;
			props.link.sourceLoaded = false;
			props.keepScrollPosition();
		};

		const onTrustChange = (_kind: string, trusted: boolean) => {
			if (trusted) {
				// Trusting from a hidden preview means "and show this one too".
				if (props.link.revealed === false) {
					failed.value = false;
					props.link.revealed = undefined;
				}
			} else if (revealed.value && props.link.revealed !== true) {
				// Whatever is on screen stays on screen: the reader already saw
				// it, and this is about what happens next time.
				props.link.revealed = true;
			}
		};

		const openTrustMenu = (event: MouseEvent) => {
			const items = mediaTrustMenu(props.link, onTrustChange);

			if (items.length === 0) {
				return;
			}

			// The context menu positions itself at the pointer; a keyboard
			// activation has no pointer, so anchor it under the button.
			let at = event;

			if (event.clientX === 0 && event.clientY === 0) {
				const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
				at = new MouseEvent("click", {
					clientX: rect.left,
					clientY: rect.bottom,
					bubbles: false,
				});
			}

			eventbus.emit("contextmenu:items", {event: at, items});
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
			content,
			container,
			failed,
			host,
			hasScopes,
			trustedKinds,
			revealed,
			veilTitle,
			veilHint,
			veilLabel,
			trustTitle,
			onPreviewReady,
			onPreviewError,
			reveal,
			hide,
			openTrustMenu,
			onThumbnailClick,
		};
	},
});
</script>
