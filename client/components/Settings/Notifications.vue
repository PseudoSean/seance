<template>
	<div>
		<h2>Push Notifications</h2>
		<div>
			<div id="pushState" class="push-state">
				<span
					class="push-state-dot"
					:class="'push-state-' + store.state.pushNotificationState"
					aria-hidden="true"
				></span>
				<strong>{{ pushStateLabel }}</strong>
			</div>
			<div class="push-networks">
				<div v-for="row in pushNetworks" :key="row.uuid" class="push-network">
					<router-link :to="'/edit-network/' + row.uuid">{{ row.name }}</router-link>
					<span class="push-network-state" :class="'push-net-' + row.state">{{
						row.label
					}}</span>
				</div>
				<div class="push-networks-hint">
					Push is set up per network — turn it on or off in each network's settings (Edit
					network → “Push notifications for this network”). The browser delivers the
					notifications; each push-capable server decides whether to wake this app.
				</div>
			</div>
			<div v-if="store.state.pushNotificationState === 'subscribed'" class="opt">
				<div>Snooze pushes everywhere:</div>
				<div class="push-snooze">
					<button type="button" class="btn" @click.prevent="snooze(15 * 60 * 1000)">
						15 min
					</button>
					<button type="button" class="btn" @click.prevent="snooze(60 * 60 * 1000)">
						1 hour
					</button>
					<button type="button" class="btn" @click.prevent="snooze(8 * 60 * 60 * 1000)">
						8 hours
					</button>
					<button type="button" class="btn" @click.prevent="snooze(0)">Off</button>
				</div>
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

		// One-line verdict for the indicator dot above the list.
		const pushStateLabels: Record<string, string> = {
			subscribed: "On for this device",
			unsubscribed: "Off",
			denied: "Blocked by the browser",
			blocked: "The server refused the subscription",
			"server-unsupported": "No push-capable network",
			unsupported: "Not supported by this browser",
			"not-installed": "Install the app to enable",
		};

		const pushStateLabel = computed(
			() =>
				pushStateLabels[store.state.pushNotificationState] ??
				store.state.pushNotificationState
		);

		// Per-network push rows. Reads `store.state.networks` (every connected
		// network) and webpush's reactive per-network view; re-renders whenever
		// a network announces itself or the subscription state changes.
		const pushNetworks = computed(() =>
			store.state.networks.map((net) => {
				const info = webpush.networkPushInfo(net.uuid);
				const state = !info.enabled
					? "off"
					: !info.vapid
					? "unsupported"
					: info.subscribed
					? "on"
					: "ready";
				const labels: Record<string, string> = {
					on: "Subscribed",
					off: "Off (disabled in network settings)",
					unsupported: "Server has no push support",
					ready: "Ready — enable in network settings",
				};

				return {uuid: net.uuid, name: net.name, state, label: labels[state]};
			})
		);

		const snooze = (ms: number) => {
			webpush.setSnooze(ms);
		};

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
			pushNetworks,
			snooze,
			pushStateLabel,
		};
	},
});
</script>
