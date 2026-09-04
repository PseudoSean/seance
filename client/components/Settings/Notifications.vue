<template>
	<div>
		<h2>Push Notifications</h2>
		<div>
			<div class="push-networks-hint">
				Push is set up per network — turn it on or off in each network's settings (Edit
				network → “Push notifications for this network”), where the enrollment status is
				also shown. The browser delivers the notifications; each push-capable server decides
				whether to wake this app.
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

			<div v-if="devices.network" class="push-devices">
				<div class="push-devices-head">
					<span>Registered devices</span>
					<button
						type="button"
						class="btn btn-small"
						:disabled="devices.loading"
						@click.prevent="refreshDevices"
					>
						{{ devices.loading ? "Loading…" : "Refresh" }}
					</button>
				</div>

				<p v-if="!devices.loading && devices.subs.length === 0" class="push-devices-empty">
					No devices are registered for push on this account.
				</p>

				<ul v-else class="push-device-list">
					<li v-for="sub in devices.subs" :key="sub.endpoint" class="push-device">
						<div class="push-device-label">
							<span class="push-device-host">{{ endpointHost(sub.endpoint) }}</span>
							<span v-if="sub.thisDevice" class="push-device-tag this"
								>This device</span
							>
							<span
								v-if="!sub.current"
								class="push-device-tag stale"
								title="Registered under a superseded key; the server can no longer reach it."
								>Stale</span
							>
							<span v-if="armedAge(sub.armed)" class="push-device-age">{{
								armedAge(sub.armed)
							}}</span>
						</div>
						<button
							type="button"
							class="btn btn-small"
							@click.prevent="removeDevice(sub.endpoint)"
						>
							Remove
						</button>
					</li>
				</ul>

				<button
					v-if="devices.subs.length > 0"
					type="button"
					class="btn btn-small push-devices-clear"
					@click.prevent="clearAllDevices"
				>
					Clear all devices
				</button>
				<p class="push-networks-hint">
					Removing a device unregisters it on the server so it stops receiving pushes.
					Clearing all also unsubscribes this browser.
				</p>
			</div>
		</div>

		<h2>Browser Notifications</h2>
		<div>
			<div class="push-networks-hint">
				Browser notifications are also per network — enabled by default, toggled in each
				network's settings (Edit network → “Browser notifications for this network”).
			</div>
			<div v-if="store.state.desktopNotificationState === 'unsupported'" class="error">
				<strong>Warning</strong>: Notifications are not supported by your browser.
			</div>
			<div v-if="store.state.desktopNotificationState === 'nohttps'" class="error">
				<strong>Warning</strong>: Notifications are only supported over HTTPS connections.
			</div>
			<div v-if="store.state.desktopNotificationState === 'blocked'" class="error">
				<strong>Warning</strong>: Notifications are blocked by your browser.
			</div>
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
import {defineComponent, onMounted} from "vue";
import {useStore} from "../../js/store";
import webpush from "../../js/webpush";

export default defineComponent({
	name: "NotificationSettings",
	setup() {
		const store = useStore();

		const snooze = (ms: number) => {
			webpush.setSnooze(ms);
		};

		const devices = webpush.deviceList;
		const refreshDevices = () => webpush.refreshDevices();
		const removeDevice = (endpoint: string) => webpush.removeDevice(endpoint);
		const clearAllDevices = () => webpush.clearAllDevices();

		/** "fcm.googleapis.com" from an endpoint, for a readable device label. */
		const endpointHost = (endpoint: string): string => {
			try {
				return new URL(endpoint).host;
			} catch {
				return endpoint.slice(0, 40);
			}
		};

		/** "3 days ago" style age from a unix time (seconds); "" if unknown. */
		const armedAge = (armed: number): string => {
			if (!armed) {
				return "";
			}

			const secs = Math.max(0, Math.floor(Date.now() / 1000) - armed);
			const day = 86400;

			if (secs < 3600) {
				return `${Math.max(1, Math.floor(secs / 60))} min ago`;
			}

			if (secs < day) {
				return `${Math.floor(secs / 3600)} h ago`;
			}

			return `${Math.floor(secs / day)} d ago`;
		};

		onMounted(() => {
			webpush.refresh();
			webpush.refreshDevices();
		});

		const playNotification = () => {
			const pop = new Audio();
			pop.src = "audio/pop.wav";

			// eslint-disable-next-line
			pop.play();
		};

		return {
			store,
			playNotification,
			snooze,
			devices,
			refreshDevices,
			removeDevice,
			clearAllDevices,
			endpointHost,
			armedAge,
		};
	},
});
</script>
