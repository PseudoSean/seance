<template>
	<div>
		<h2>{{ t("settings.notifications.pushHeading") }}</h2>
		<div>
			<div class="push-networks-hint">
				{{ t("settings.notifications.pushPerNetwork") }}
			</div>
			<div
				id="label-push-key-change"
				class="push-networks-hint"
				role="heading"
				aria-level="3"
			>
				{{ t("settings.notifications.keyChangeIntro") }}
			</div>
			<div role="group" aria-labelledby="label-push-key-change">
				<label class="opt">
					<input
						:checked="store.state.settings.pushKeyChange === 'ask'"
						type="radio"
						name="pushKeyChange"
						value="ask"
					/>
					{{ t("settings.notifications.keyChangeAsk") }}
				</label>
				<label class="opt">
					<input
						:checked="store.state.settings.pushKeyChange === 'trust'"
						type="radio"
						name="pushKeyChange"
						value="trust"
					/>
					{{ t("settings.notifications.keyChangeTrust") }}
				</label>
				<label class="opt">
					<input
						:checked="store.state.settings.pushKeyChange === 'ignore'"
						type="radio"
						name="pushKeyChange"
						value="ignore"
					/>
					{{ t("settings.notifications.keyChangeIgnore") }}
				</label>
			</div>
			<div v-if="store.state.pushNotificationState === 'subscribed'" class="opt">
				<div>{{ t("settings.notifications.snoozeIntro") }}</div>
				<div class="push-snooze">
					<button type="button" class="btn" @click.prevent="snooze(15 * 60 * 1000)">
						{{ t("settings.notifications.snooze15") }}
					</button>
					<button type="button" class="btn" @click.prevent="snooze(60 * 60 * 1000)">
						{{ t("settings.notifications.snooze60") }}
					</button>
					<button type="button" class="btn" @click.prevent="snooze(8 * 60 * 60 * 1000)">
						{{ t("settings.notifications.snooze480") }}
					</button>
					<button type="button" class="btn" @click.prevent="snooze(0)">
						{{ t("settings.notifications.snoozeOff") }}
					</button>
				</div>
			</div>
			<div v-if="store.state.pushNotificationState === 'stale'" id="pushStale" class="error">
				<strong>{{ t("settings.notifications.warning") }}</strong
				>:
				{{ t("settings.notifications.stale") }}
			</div>
			<div v-if="store.state.pushNotificationState === 'unsupported'" class="error">
				{{ t("settings.notifications.unsupported") }}
			</div>
			<div v-if="store.state.pushNotificationState === 'not-installed'" class="error">
				<strong>{{ t("settings.notifications.warning") }}</strong
				>:
				{{ t("settings.notifications.iosNotInstalled") }}
			</div>
			<div v-if="store.state.pushNotificationState === 'denied'" class="error">
				<strong>{{ t("settings.notifications.warning") }}</strong
				>:
				{{ t("settings.notifications.pushDenied") }}
			</div>
			<div v-if="store.state.pushNotificationState === 'server-unsupported'" class="error">
				{{ t("settings.notifications.serverUnsupported") }}
			</div>
			<div v-if="store.state.pushNotificationState === 'blocked'" class="error">
				<strong>{{ t("settings.notifications.warning") }}</strong
				>:
				{{ t("settings.notifications.pushBlocked") }}
			</div>
		</div>

		<h2>{{ t("settings.notifications.browserHeading") }}</h2>
		<div>
			<div class="push-networks-hint">
				{{ t("settings.notifications.browserPerNetwork") }}
			</div>
			<div v-if="store.state.desktopNotificationState === 'unsupported'" class="error">
				<strong>{{ t("settings.notifications.warning") }}</strong
				>:
				{{ t("settings.notifications.browserUnsupported") }}
			</div>
			<div v-if="store.state.desktopNotificationState === 'nohttps'" class="error">
				<strong>{{ t("settings.notifications.warning") }}</strong
				>:
				{{ t("settings.notifications.noHttps") }}
			</div>
			<div v-if="store.state.desktopNotificationState === 'blocked'" class="error">
				<strong>{{ t("settings.notifications.warning") }}</strong
				>:
				{{ t("settings.notifications.browserBlocked") }}
			</div>
		</div>
		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.notification"
					type="checkbox"
					name="notification"
				/>
				{{ t("settings.notifications.sound") }}
			</label>
		</div>
		<div>
			<div class="opt">
				<button id="play" @click.prevent="playNotification">
					{{ t("settings.notifications.playSound") }}
				</button>
			</div>
		</div>

		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.notifyAllMessages"
					type="checkbox"
					name="notifyAllMessages"
				/>
				{{ t("settings.notifications.notifyAll") }}
			</label>
		</div>

		<div>
			<label class="opt">
				<input
					:checked="store.state.settings.highlightMessages"
					type="checkbox"
					name="highlightMessages"
				/>
				{{ t("settings.notifications.highlight") }}
				<span
					class="tooltipped tooltipped-n tooltipped-no-delay"
					:aria-label="highlightHelp"
				>
					<button class="extra-help" />
				</span>
			</label>
		</div>

		<div v-if="!store.state.serverConfiguration?.public">
			<label class="opt">
				<label for="highlights" class="opt">
					{{ t("settings.notifications.highlights") }}
					<span
						class="tooltipped tooltipped-n tooltipped-no-delay"
						:aria-label="highlightsHelp"
					>
						<button class="extra-help" />
					</span>
				</label>
				<input
					id="highlights"
					dir="auto"
					:value="store.state.settings.highlights"
					type="text"
					name="highlights"
					class="input"
					autocomplete="off"
					:placeholder="commaListPlaceholder"
				/>
			</label>
		</div>

		<div v-if="!store.state.serverConfiguration?.public">
			<label class="opt">
				<label for="highlightExceptions" class="opt">
					{{ t("settings.notifications.highlightExceptions") }}
					<span
						class="tooltipped tooltipped-n tooltipped-no-delay"
						:aria-label="highlightExceptionsHelp"
					>
						<button class="extra-help" />
					</span>
				</label>
				<input
					id="highlightExceptions"
					dir="auto"
					:value="store.state.settings.highlightExceptions"
					type="text"
					name="highlightExceptions"
					class="input"
					autocomplete="off"
					:placeholder="commaListPlaceholder"
				/>
			</label>
		</div>
	</div>
</template>

<script lang="ts">
import {computed, defineComponent, onMounted} from "vue";
import {useStore} from "../../js/store";
import {useI18n} from "../../js/i18n";
import webpush from "../../js/webpush";

export default defineComponent({
	name: "NotificationSettings",
	setup() {
		const store = useStore();
		const {t} = useI18n();

		const highlightHelp = computed(() => t("settings.notifications.highlightHelp"));
		const highlightsHelp = computed(() => t("settings.notifications.highlightsHelp"));
		const highlightExceptionsHelp = computed(() =>
			t("settings.notifications.highlightExceptionsHelp")
		);
		const commaListPlaceholder = computed(() => t("settings.notifications.commaList"));

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
			store,
			t,
			highlightHelp,
			highlightsHelp,
			highlightExceptionsHelp,
			commaListPlaceholder,
			playNotification,
			snooze,
		};
	},
});
</script>
