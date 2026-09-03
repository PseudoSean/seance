<template>
	<div id="push-prompt-overlay" :class="{opened: webpush.pushPrompt.visible}">
		<div v-if="webpush.pushPrompt.visible" id="push-prompt" role="dialog" aria-modal="true">
			<div class="confirm-text">
				<div class="confirm-text-title">Enable push notifications?</div>
				<p>
					The server can wake this app when it has messages for you while it is closed.
					You can change this any time in Settings → Push Notifications.
				</p>
			</div>
			<div class="confirm-buttons">
				<button id="pushPromptNever" type="button" class="btn" @click.prevent="never">
					Never
				</button>
				<button id="pushPromptNo" type="button" class="btn btn-cancel" @click.prevent="no">
					No
				</button>
				<button id="pushPromptYes" type="button" class="btn" @click.prevent="yes">
					Yes
				</button>
			</div>
		</div>
	</div>
</template>

<style>
#push-prompt {
	background: var(--body-bg-color);
	color: #fff;
	margin: 10px;
	border-radius: 5px;
	max-width: 500px;
}

#push-prompt .confirm-text {
	padding: 15px;
	user-select: text;
}

#push-prompt .confirm-text-title {
	font-size: 20px;
	font-weight: 700;
	margin-bottom: 10px;
}

#push-prompt .confirm-buttons {
	display: flex;
	justify-content: flex-end;
	padding: 15px;
	background: rgba(0, 0, 0, 0.3);
}

#push-prompt .confirm-buttons .btn {
	margin-bottom: 0;
	margin-left: 10px;
}

#push-prompt .confirm-buttons .btn-cancel {
	border-color: transparent;
}
</style>

<script lang="ts">
import {defineComponent, onMounted, onUnmounted} from "vue";
import eventbus from "../js/eventbus";
import webpush from "../js/webpush";

/**
 * The connect-time "enable push notifications?" prompt (yes / no / never).
 * webpush.ts decides when to show it — once per connection that logged in
 * with SASL on a push-capable network, unless this device answered "never"
 * or already holds a subscription. "Yes" reuses the Settings subscribe flow,
 * so the button click doubles as the permission user gesture.
 */
export default defineComponent({
	name: "PushPrompt",
	setup() {
		const no = () => webpush.declinePrompt();
		const never = () => webpush.neverPrompt();
		const yes = () => webpush.acceptPrompt();

		const onEscape = () => {
			if (webpush.pushPrompt.visible) {
				no();
			}
		};

		onMounted(() => {
			eventbus.on("escapekey", onEscape);
		});

		onUnmounted(() => {
			eventbus.off("escapekey", onEscape);
		});

		return {
			webpush,
			no,
			never,
			yes,
		};
	},
});
</script>
