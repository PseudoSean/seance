<template>
	<div
		v-if="isOpen"
		id="mentions-popup-container"
		@click="containerClick"
		@contextmenu="containerClick"
	>
		<div class="mentions-popup">
			<div class="mentions-popup-title">
				{{ t("mentions.title") }}
				<button
					v-if="resolvedMessages.length"
					class="btn dismiss-all-mentions"
					@click="dismissAllMentions()"
				>
					{{ t("mentions.dismissAll") }}
				</button>
			</div>
			<template v-if="resolvedMessages.length === 0">
				<p v-if="isLoading">{{ t("mentions.loading") }}</p>
				<p v-else>{{ t("mentions.empty") }}</p>
			</template>
			<template v-for="message in resolvedMessages" v-else :key="message.msgId">
				<div :class="['msg', message.type]">
					<div class="mentions-info">
						<div>
							<span class="from">
								<Username :user="(message.from as any)" />
								<template v-if="message.channel">
									{{
										t("mentions.inOn", {
											channel: message.channel.channel.name,
											network: message.channel.network.name,
										})
									}}
								</template>
								<template v-else>{{ t("mentions.inUnknown") }}</template> </span
							>{{ ` ` }}
							<span :title="message.fullTime" class="time">
								{{ messageTime(message.time) }}
							</span>
						</div>
						<div>
							<span
								class="close-tooltip tooltipped tooltipped-w"
								:aria-label="dismissLabel"
							>
								<button
									class="msg-dismiss"
									:aria-label="dismissLabel"
									@click="dismissMention(message)"
								></button>
							</span>
						</div>
					</div>
					<div class="content" dir="auto">
						<ParsedMessage :message="(message as any)" />
					</div>
				</div>
			</template>
		</div>
	</div>
</template>

<style>
#mentions-popup-container {
	z-index: 8;
}

.mentions-popup {
	background-color: var(--window-bg-color);
	position: absolute;
	width: 400px;
	inset-inline-end: 80px;
	top: 55px;
	max-height: 400px;
	overflow-y: auto;
	z-index: 2;
	padding: 10px;
}

.mentions-popup > .mentions-popup-title {
	display: flex;
	justify-content: space-between;
	margin-bottom: 10px;
	font-size: 1.25rem;
}

.mentions-popup .mentions-info {
	display: flex;
	justify-content: space-between;
}

.mentions-popup .msg {
	margin-bottom: 15px;
	user-select: text;
}

.mentions-popup .msg:last-child {
	margin-bottom: 0;
}

.mentions-popup .msg .content {
	background-color: var(--highlight-bg-color);
	border-radius: 5px;
	padding: 6px;
	margin-top: 2px;
	word-wrap: break-word;
	word-break: break-word; /* Webkit-specific */
}

.mentions-popup .msg-dismiss::before {
	font-size: 1.25rem;
	font-weight: normal;
	display: inline-block;
	line-height: 16px;
	text-align: center;
	content: "×";
}

.mentions-popup .msg-dismiss:hover {
	color: var(--link-color);
}

.mentions-popup .dismiss-all-mentions {
	margin: 0;
	padding: 4px 6px;
}

@media (min-height: 500px) {
	.mentions-popup {
		max-height: 60vh;
	}
}

@media (max-width: 768px), (max-height: 500px) and (hover: none) and (pointer: coarse) {
	.mentions-popup {
		border-radius: 0;
		border: 0;
		box-shadow: none;
		width: 100%;
		max-height: none;
		right: 0;
		left: 0;
		bottom: 0;
		top: 3rem; /* header height */
	}
}
</style>

<script lang="ts">
import Username from "./Username.vue";
import ParsedMessage from "./ParsedMessage.vue";
import {
	dismissMention as dismissStoredMention,
	dismissAllMentions as dismissAllStoredMentions,
} from "../js/mentions";
import eventbus from "../js/eventbus";
import {formatDateTime, formatRelativeTime} from "../js/i18n/dates";
import {computed, watch, defineComponent, ref, onMounted, onUnmounted} from "vue";
import {useStore} from "../js/store";
import {useI18n} from "../js/i18n";
import type {SharedMention} from "../../shared/types/mention";
import type {NetChan} from "../js/types";

type MentionWithContext = SharedMention & {
	fullTime: string;
	channel: NetChan | null;
};

export default defineComponent({
	name: "Mentions",
	components: {
		Username,
		ParsedMessage,
	},
	setup() {
		const store = useStore();
		const {t, locale} = useI18n();
		const isOpen = ref(false);
		const isLoading = ref(false);
		const resolvedMessages = computed(() => {
			// locale.value is read so a language change re-renders the
			// Intl-formatted timestamps (Intl itself is not reactive).
			void locale.value;
			return store.state.mentions
				.slice()
				.reverse()
				.map((message) => ({
					...message,
					fullTime: formatDateTime(message.time),
					channel: store.getters.findChannel(message.chanId),
				}))
				.filter((message) => !message.channel?.channel.muted);
		});

		watch(
			() => store.state.mentions,
			() => {
				isLoading.value = false;
			}
		);

		const dismissLabel = computed(() => t("mentions.dismissOne"));

		const messageTime = (time: Date) => {
			void locale.value;
			return formatRelativeTime(time.getTime());
		};

		const dismissMention = (message: MentionWithContext) => {
			dismissStoredMention(message.msgId);
		};

		const dismissAllMentions = () => {
			dismissAllStoredMentions();
		};

		const containerClick = (event: Event) => {
			if (event.currentTarget === event.target) {
				isOpen.value = false;
			}
		};

		const togglePopup = () => {
			isOpen.value = !isOpen.value;

			// Mentions are kept locally, so there is nothing to fetch
			isLoading.value = false;
		};

		const closePopup = () => {
			isOpen.value = false;
		};

		onMounted(() => {
			eventbus.on("mentions:toggle", togglePopup);
			eventbus.on("escapekey", closePopup);
		});

		onUnmounted(() => {
			eventbus.off("mentions:toggle", togglePopup);
			eventbus.off("escapekey", closePopup);
		});

		return {
			isOpen,
			isLoading,
			resolvedMessages,
			t,
			dismissLabel,
			messageTime,
			dismissMention,
			dismissAllMentions,
			containerClick,
		};
	},
});
</script>
