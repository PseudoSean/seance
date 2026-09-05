<template>
	<div id="push-prompt-overlay" :class="{opened: webpush.pushPrompt.visible}">
		<div
			v-if="webpush.pushPrompt.visible"
			id="push-prompt"
			:class="webpush.pushPrompt.kind"
			role="dialog"
			aria-modal="true"
		>
			<div v-if="webpush.pushPrompt.kind === 'renew'" class="confirm-text">
				<div class="confirm-text-title">Renew push notifications?</div>
				<p>
					The server's push key changed, so this device's push subscription no longer
					works. Subscribe again to keep being notified while the app is closed. You can
					also do this later under Settings → Notifications.
				</p>
			</div>
			<div v-else class="confirm-text">
				<div class="confirm-text-title">Enable push notifications?</div>
				<p>
					The server can wake this app when it has messages for you while it is closed.
					You can change this per network, in each network's settings.
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
 * The connect-time push prompt (yes / no / never), in two variants:
 * "enable push notifications?" when nothing is subscribed, and "renew?"
 * when the stored subscription was made against a VAPID key the server no
 * longer announces (a rotation — the browser refuses to re-subscribe until
 * the old subscription is dropped, and doing that silently would leave a
 * device that stopped receiving pushes without a word). webpush.ts decides
 * when to show which — once per connection that logged in with SASL on a
 * push-capable network, unless this device answered "never" to that
 * question. "Yes" runs the subscribe flow, so the button click doubles as
 * the permission user gesture.
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
