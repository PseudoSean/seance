<template>
	<div>
		<h2>Push Notifications</h2>
		<div>
			<button
				id="pushNotifications"
				type="button"
				class="btn"
				:disabled="!pushToggleable"
				@click.prevent="togglePush"
			>
				{{
					store.state.pushNotificationState === "subscribed"
						? "Unsubscribe from push notifications"
						: "Subscribe to push notifications"
				}}
			</button>
			<div v-if="store.state.pushNotificationState === 'subscribed'" id="pushSubscribed">
				Push notifications are enabled for this device. The server will wake the app when it
				has something for you while it is closed.
			</div>
			<div v-if="store.state.pushNotificationState === 'unsupported'" class="error">
				Push notifications are not supported by this browser (they need the Push API, a
				service worker and a secure context).
			</div>
			<div v-if="store.state.pushNotificationState === 'not-installed'" class="error">
				<strong>Warning</strong>: On iOS, push notifications are only available after
				installing the app to the Home Screen (Share → Add to Home Screen).
			</div>
			<div v-if="store.state.pushNotificationState === 'denied'" class="error">
				<strong>Warning</strong>: Notifications are blocked by your browser. Allow them in
				the browser's site settings, then try again.
			</div>
			<div v-if="store.state.pushNotificationState === 'server-unsupported'" class="error">
				Push notifications need a connected server that supports the draft/webpush
				capability and you to be logged in to an account.
			</div>
			<div v-if="store.state.pushNotificationState === 'blocked'" class="error">
				<strong>Warning</strong>: The server refused the push subscription. It may require
				logging in (SASL) before subscribing.
			</div>
		</div>

		<h2>Browser Notifications</h2>
		<div>
			<label class="opt">
				<input
					id="desktopNotifications"
					:checked="store.state.settings.desktopNotifications"
					:disabled="store.state.desktopNotificationState === 'nohttps'"
					type="checkbox"
					name="desktopNotifications"
				/>
				Enable browser notifications<br />
				<div v-if="store.state.desktopNotificationState === 'unsupported'" class="error">
					<strong>Warning</strong>: Notifications are not supported by your browser.
				</div>
				<div
					v-if="store.state.desktopNotificationState === 'nohttps'"
					id="warnBlockedDesktopNotifications"
					class="error"
				>
					<strong>Warning</strong>: Notifications are only supported over HTTPS
					connections.
				</div>
				<div
					v-if="store.state.desktopNotificationState === 'blocked'"
					id="warnBlockedDesktopNotifications"
					class="error"
				>
					<strong>Warning</strong>: Notifications are blocked by your browser.
				</div>
			</label>
		</div>
		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.notification"
					type="checkbox"
					name="notification"
				/>
				Enable notification sound
			</label>
		</div>
		<div>
			<div class="opt">
				<button id="play" @click.prevent="playNotification">Play sound</button>
			</div>
		</div>

		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.notifyAllMessages"
					type="checkbox"
					name="notifyAllMessages"
				/>
				Enable notification for all messages
			</label>
		</div>

		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.highlightMessages"
					type="checkbox"
					name="highlightMessages"
				/>
				Highlight messages that mention you
				<span
					class="tooltipped tooltipped-n tooltipped-no-delay"
					aria-label="Messages that mention you or match a custom highlight get a
colored background and border in the channel."
				>
					<button class="extra-help" />
				</span>
			</label>
		</div>

		<div v-if="!store.state.serverConfiguration?.public">
			<label class="opt">
				<label for="highlights" class="opt">
					Custom highlights
					<span
						class="tooltipped tooltipped-n tooltipped-no-delay"
						aria-label="If a message contains any of these comma-separated
expressions, it will trigger a highlight."
					>
						<button class="extra-help" />
					</span>
				</label>
				<input
					id="highlights"
					:value="store.state.settings.highlights"
					type="text"
					name="highlights"
					class="input"
					autocomplete="off"
					placeholder="Comma-separated, e.g.: word, some more words, anotherword"
				/>
			</label>
		</div>

		<div v-if="!store.state.serverConfiguration?.public">
			<label class="opt">
				<label for="highlightExceptions" class="opt">
					Highlight exceptions
					<span
						class="tooltipped tooltipped-n tooltipped-no-delay"
						aria-label="If a message contains any of these comma-separated
expressions, it will not trigger a highlight even if it contains
your nickname or expressions defined in custom highlights."
					>
						<button class="extra-help" />
					</span>
				</label>
				<input
					id="highlightExceptions"
					:value="store.state.settings.highlightExceptions"
					type="text"
					name="highlightExceptions"
					class="input"
					autocomplete="off"
					placeholder="Comma-separated, e.g.: word, some more words, anotherword"
				/>
			</label>
		</div>
	</div>
</template>

<script lang="ts">
import {computed, defineComponent, onMounted} from "vue";
import {useStore} from "../../js/store";
import webpush from "../../js/webpush";

export default defineComponent({
	name: "NotificationSettings",
	setup() {
		const store = useStore();

		const isIOS = computed(
			() =>
				[
					"iPad Simulator",
					"iPhone Simulator",
					"iPod Simulator",
					"iPad",
					"iPhone",
					"iPod",
				].includes(navigator.platform) ||
				// iPad on iOS 13 detection
				(navigator.userAgent.includes("Mac") && "ontouchend" in document)
		);

		// The toggle only works when the browser can subscribe and nothing
		// harder (denied permission, refused subscription) is in the way; the
		// error blocks above explain every disabled state.
		const pushToggleable = computed(() =>
			["unsubscribed", "subscribed"].includes(store.state.pushNotificationState)
		);

		const togglePush = () => {
			void webpush.togglePushSubscription();
		};

		// Notification permission changes outside the app (site settings);
		// re-read it whenever this page opens.
		onMounted(() => {
			webpush.refresh();
		});

		const playNotification = () => {
			const pop = new Audio();
			pop.src = "audio/pop.wav";

			// eslint-disable-next-line
			pop.play();
		};

		return {
			isIOS,
			store,
			playNotification,
			pushToggleable,
			togglePush,
		};
	},
});
</script>
