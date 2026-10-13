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
			<div class="dnd-schedule">
				<label class="opt">
					<input
						v-switch
						type="checkbox"
						:checked="schedule.enabled"
						@change="update({enabled: ($event.target as HTMLInputElement).checked})"
					/>
					Do not disturb on a schedule
				</label>
				<!-- Inactive while the schedule is off: dimmed and disabled. -->
				<fieldset
					:class="['dnd-schedule-fields', {disabled: !schedule.enabled}]"
					:disabled="!schedule.enabled"
				>
					<div class="dnd-times">
						<label
							>From
							<input
								type="time"
								aria-label="Do not disturb from"
								:value="schedule.start"
								@change="setTime('start', $event)"
						/></label>
						<label
							>until
							<input
								type="time"
								aria-label="Do not disturb until"
								:value="schedule.end"
								@change="setTime('end', $event)"
						/></label>
					</div>
					<div class="dnd-days" role="group" aria-label="Days">
						<label v-for="(name, day) in DAYS" :key="day">
							<input
								v-switch
								type="checkbox"
								:aria-label="DAY_FULL_NAMES[day]"
								:checked="schedule.days.includes(day)"
								@change="toggleDay(day)"
							/>
							{{ name }}
						</label>
					</div>
				</fieldset>
				<p class="dnd-schedule-hint">
					While do not disturb is on, you show as away and nothing alerts you here or
					through push. Push stops on all your devices signed in to the same account. If
					no {{ appName }} is open when a scheduled window starts, push stops once one
					opens. Same start and end: all day.
				</p>
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
				{{
					androidShell
						? t("settings.notifications.pushDeniedAndroid")
						: t("settings.notifications.pushDenied")
				}}
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
					v-switch
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
					v-switch
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
					v-switch
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
import dnd from "../../js/dnd";
import {DAYS, DAY_FULL_NAMES, HHMM, type DndSchedule} from "../../js/helpers/dnd";
import {isAndroidShell} from "../../js/helpers/capacitor";

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

		// The do-not-disturb schedule (client/js/dnd.ts); every edit saves at once.
		const schedule = computed(() => dnd.state.schedule);
		const update = (patch: Partial<DndSchedule>) =>
			dnd.setSchedule({...dnd.state.schedule, ...patch});

		// A cleared time field reports "": keep the stored time and show it again.
		const setTime = (field: "start" | "end", event: Event) => {
			const input = event.target as HTMLInputElement;

			if (!HHMM.test(input.value)) {
				input.value = schedule.value[field];
				return;
			}

			update(field === "start" ? {start: input.value} : {end: input.value});
		};

		const toggleDay = (day: number) => {
			const days = schedule.value.days.includes(day)
				? schedule.value.days.filter((d) => d !== day)
				: [...schedule.value.days, day].sort((a, b) => a - b);
			update({days});
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
			androidShell: isAndroidShell(),
			playNotification,
			// Sunday = 0, the day a window starts on (helpers/dnd.ts DndSchedule.days).
			DAYS,
			DAY_FULL_NAMES,
			appName: computed(() => store.state.branding.appName),
			schedule,
			update,
			setTime,
			toggleDay,
		};
	},
});
</script>
