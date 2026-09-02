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
			<button
				id="pushNotifications"
				type="button"
				class="btn"
				:disabled="!pushToggleable"
				:aria-pressed="store.state.pushNotificationState === 'subscribed'"
				@click.prevent="togglePush"
			>
				{{
					store.state.pushNotificationState === "subscribed"
						? "Turn off push notifications"
						: "Subscribe to push notifications"
				}}
			</button>
			<div v-if="store.state.pushNotificationState === 'subscribed'" id="pushSubscribed">
				Push notifications are enabled for this device. The server will wake the app when it
				has something for you while it is closed.
			</div>
			<div v-if="store.state.pushNotificationState === 'subscribed'" class="opt">
				Snooze pushes everywhere:
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

		<h2>Session</h2>
		<div>
			<p class="opt">
				The server keeps your session while you are away (bouncer-style persistence). This
				is the session the server sees right now:
			</p>
			<div v-if="sessions.length" id="sessionList">
				<div v-for="s in sessions" :key="s.sessid" class="session-row">
					<span class="session-state" :class="'session-' + s.state.toLowerCase()">{{
						s.state
					}}</span>
					<strong>{{ s.nick }}</strong>
					<span v-if="s.channels.length"> in {{ s.channels.join(", ") }}</span>
					<div class="session-info">
						{{ s.info }}
					</div>
				</div>
			</div>
			<div v-else-if="sessionsLoaded" id="sessionEmpty">
				No persistence session (you are not holding a connection on the server).
			</div>
			<div class="opt">
				<button
					id="refreshSessions"
					type="button"
					class="btn"
					@click.prevent="loadSessions"
				>
					Refresh
				</button>
				<button id="forceLogout" type="button" class="btn" @click.prevent="forceLogout">
					Force logout (end session)
				</button>
			</div>
			<p class="opt">
				Force logout ends this device's server session (it drops the hold and the ghost
				nick). Other devices' push subscriptions cannot be listed or revoked from here — the
				draft/webpush extension has no listing verb; each device unsubscribes itself.
			</p>
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
import {computed, defineComponent, onMounted, onUnmounted, ref} from "vue";
import {useStore} from "../../js/store";
import socket from "../../js/socket";
import webpush from "../../js/webpush";
import type {PushSession} from "../../../shared/types/socket-events";

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

		// One-line verdict for the indicator dot above the toggle.
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

		const togglePush = () => {
			void webpush.togglePushSubscription();
		};

		const snooze = (ms: number) => {
			webpush.setSnooze(ms);
		};

		// Session panel: the account's bouncer session as the server sees it
		// (`PERSISTENCE LIST` → SESSION/ENDOFLIST → `persistence:sessions`).
		const sessions = ref<PushSession[]>([]);
		const sessionsLoaded = ref(false);

		const loadSessions = () => {
			sessionsLoaded.value = true;
			socket.emit("persistence:sessions:list", {});
		};

		const forceLogout = () => {
			socket.emit("persistence:sessions:logout", {});
		};

		const onSessions = (data: {sessions: PushSession[]}) => {
			sessions.value = data.sessions;
			sessionsLoaded.value = true;
		};

		onMounted(() => {
			webpush.refresh();
			socket.on("persistence:sessions", onSessions);
			loadSessions();
		});

		onUnmounted(() => {
			socket.off("persistence:sessions", onSessions);
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
			snooze,
			pushStateLabel,
			sessions,
			sessionsLoaded,
			loadSessions,
			forceLogout,
		};
	},
});
</script>
