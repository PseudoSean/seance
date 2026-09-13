<template>
	<div
		id="connect"
		:class="['window', {'network-form-embedded': embedded}]"
		:role="embedded ? undefined : 'tabpanel'"
		:aria-label="ariaEditLabel"
	>
		<div v-if="!embedded" class="header">
			<SidebarToggle />
		</div>
		<form :class="{container: !embedded}" method="post" action="" @submit.prevent="onSubmit">
			<h1 class="title">
				<input v-model="defaults.uuid" type="hidden" name="uuid" />
				{{ t("form.editTitle", {name: displayName(defaults)}) }}
			</h1>

			<!--
				Only what `ConnectOptions` (client/js/irc/types.ts) and the saved
				network store support is offered. Dropped from TheLounge's form:
				server password, "only allow trusted certificates", SOCKS proxy,
				username / real name / leave message, SASL EXTERNAL (client
				certificates) and the STS lock — none of them apply to a browser
				WebSocket connection, or they wait on later phases (STS: D.6).
			-->
			<div v-if="status" class="connect-row connect-status">
				<label>{{ t("form.status") }}</label>
				<div class="input-wrap">
					<span :class="['connection-status', statusClass]">{{ statusText }}</span>
					<button
						v-if="handleAction"
						type="button"
						class="btn btn-small connection-action"
						@click="onAction"
					>
						{{ actionLabel }}
					</button>
				</div>
			</div>

			<h2>{{ t("form.networkSettings") }}</h2>
			<div class="connect-row">
				<label for="connect:name">{{ t("form.name") }}</label>
				<input
					id="connect:name"
					v-model.trim="defaults.name"
					dir="auto"
					class="input"
					name="name"
					maxlength="100"
					:placeholder="namePlaceholder"
				/>
			</div>
			<div class="connect-row">
				<label for="connect:host">{{ t("form.server") }}</label>
				<div class="input-wrap">
					<input
						id="connect:host"
						v-model.trim="defaults.host"
						dir="auto"
						class="input"
						name="host"
						:aria-label="serverAddressLabel"
						autocapitalize="off"
						:autocorrect.attr="'off'"
						spellcheck="false"
						maxlength="255"
						required
					/>
					<span id="connect:portseparator">:</span>
					<input
						id="connect:port"
						v-model.number="defaults.port"
						dir="auto"
						class="input"
						type="number"
						min="1"
						max="65535"
						name="port"
						:aria-label="serverPortLabel"
						required
					/>
				</div>
			</div>
			<div class="connect-row">
				<label></label>
				<div class="input-wrap">
					<label class="tls">
						<input v-model="defaults.tls" type="checkbox" name="tls" />
						{{ t("form.useTls") }}
					</label>
					<label class="tls">
						<input v-model="defaults.autoconnect" type="checkbox" name="autoconnect" />
						{{ t("form.autoconnect") }}
					</label>
				</div>
			</div>
			<div
				v-if="status ? status.connected || status.connecting : defaults.connected"
				class="connect-note"
			>
				{{ t("form.applyNote") }}
			</div>

			<h2>{{ t("form.userPreferences") }}</h2>
			<div class="connect-row">
				<label for="connect:nick">{{ t("form.nick") }}</label>
				<input
					id="connect:nick"
					v-model.trim="defaults.nick"
					dir="auto"
					class="input nick"
					name="nick"
					pattern="[^\s:!@]+"
					autocapitalize="off"
					:autocorrect.attr="'off'"
					spellcheck="false"
					maxlength="100"
					required
				/>
			</div>
			<div class="connect-row">
				<label for="connect:channels">{{ t("form.channels") }}</label>
				<input
					id="connect:channels"
					v-model.trim="defaults.join"
					dir="auto"
					class="input"
					name="join"
					:placeholder="channelsPlaceholder"
					autocapitalize="off"
					:autocorrect.attr="'off'"
					spellcheck="false"
				/>
			</div>
			<div class="connect-row">
				<label for="connect:commands">
					{{ t("form.commands") }}
					<span
						class="tooltipped tooltipped-ne tooltipped-no-delay"
						:aria-label="commandsHelp"
					>
						<button class="extra-help" type="button" />
					</span>
				</label>
				<textarea
					id="connect:commands"
					ref="commandsInput"
					v-model="commandsText"
					dir="auto"
					autocomplete="off"
					class="input"
					name="commands"
					@input="resizeCommandsInput"
				/>
			</div>

			<h2 id="label-auth">{{ t("form.authentication") }}</h2>
			<div class="connect-row connect-auth" role="group" aria-labelledby="label-auth">
				<label class="opt">
					<input v-model="defaults.sasl" type="radio" name="sasl" value="" />
					{{ t("form.noAuth") }}
				</label>
				<label class="opt">
					<input v-model="defaults.sasl" type="radio" name="sasl" value="plain" />
					{{ t("form.saslPlain") }}
				</label>
			</div>

			<template v-if="defaults.sasl === 'plain'">
				<div class="connect-row">
					<label for="connect:saslAccount">{{ t("form.account") }}</label>
					<input
						id="connect:saslAccount"
						v-model.trim="defaults.saslAccount"
						dir="auto"
						class="input"
						name="saslAccount"
						maxlength="100"
						autocomplete="username"
						autocapitalize="off"
						:autocorrect.attr="'off'"
						spellcheck="false"
						required
					/>
				</div>
				<div class="connect-row">
					<label for="connect:saslPassword">{{ t("form.password") }}</label>
					<RevealPassword
						v-slot:default="slotProps"
						class="input-wrap password-container"
					>
						<input
							id="connect:saslPassword"
							v-model="defaults.saslPassword"
							dir="auto"
							class="input"
							:type="slotProps.isVisible ? 'text' : 'password'"
							name="saslPassword"
							maxlength="300"
							autocomplete="current-password"
							:placeholder="passwordPlaceholder"
						/>
					</RevealPassword>
				</div>
				<div class="connect-row">
					<label></label>
					<div class="input-wrap">
						<label class="tls">
							<input
								v-model="defaults.rememberPassword"
								type="checkbox"
								name="rememberPassword"
							/>
							{{ t("form.rememberPassword") }}
						</label>
					</div>
				</div>
				<div class="connect-row">
					<label></label>
					<div class="input-wrap">
						<label class="tls">
							<input
								v-model="defaults.pushEnabled"
								type="checkbox"
								name="pushEnabled"
							/>
							{{ t("form.pushNotifications") }}
							<span
								class="tooltipped tooltipped-n tooltipped-no-delay"
								:aria-label="pushHelp"
							>
								<button class="extra-help" />
							</span>
						</label>
					</div>
				</div>
				<div
					v-if="defaults.pushEnabled && pushInfo.stale"
					id="pushStaleRow"
					class="connect-row"
				>
					<label></label>
					<div class="input-wrap">
						<div class="push-stale-hint">
							{{ t("form.pushStaleHint") }}
						</div>
						<button id="pushRenew" type="button" class="btn" @click.prevent="renewPush">
							{{ t("form.pushRenew") }}
						</button>
					</div>
				</div>
			</template>

			<div class="connect-row">
				<label></label>
				<div class="input-wrap">
					<label class="tls">
						<input
							v-model="defaults.notifyEnabled"
							type="checkbox"
							name="notifyEnabled"
							@change="onNotifyToggle"
						/>
						{{ t("form.browserNotifications") }}
						<span
							class="tooltipped tooltipped-n tooltipped-no-delay"
							:aria-label="browserNotificationsHelp"
						>
							<button class="extra-help" />
						</span>
					</label>
				</div>
			</div>

			<div>
				<button type="submit" class="btn" :disabled="disabled ? true : false">
					{{ t("form.save") }}
				</button>
			</div>
		</form>
	</div>
</template>

<style>
.push-stale-hint {
	margin-bottom: 8px;
	font-size: 90%;
	opacity: 0.85;
}

/* The auth radios stack one per line at full width. `#connect .connect-row`
 * (style.css) is `display: flex` at the same specificity, and `#connect label`
 * is 25% wide, so plain `.connect-auth` rules lose or tie depending on bundle
 * order - chain the classes to win outright. */
#connect .connect-row.connect-auth {
	display: block;
	margin-bottom: 10px;
}

#connect.network-form-embedded {
	display: block;
	height: auto;
	overflow: visible;
	background: transparent;
	border-radius: 0;
	box-shadow: none;
}

#connect.network-form-embedded h1 {
	font-size: 1.75rem;
}

#connect .connect-row.connect-auth .opt {
	display: block;
	width: 100%;
}

#connect .connect-row.connect-auth input {
	margin: 0.15em 0.5em 0 0;
}

#connect .connect-note {
	padding: 10px;
	margin: 10px 0;
	border-radius: 2px;
	background-color: #d9edf7;
	color: #31708f;
}

#connect .connect-status .input-wrap {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-top: 8px;
}

#connect .connection-status::before {
	content: "●";
	margin-right: 6px;
}

#connect .connection-status.is-connected::before {
	color: #2ecc40;
}

#connect .connection-status.is-connecting::before {
	color: #f39c12;
}

#connect .connection-status.is-disconnected::before {
	color: #e74c3c;
}

#connect .btn.connection-action {
	width: auto;
	margin: 0;
}
</style>

<script lang="ts">
import RevealPassword from "./RevealPassword.vue";
import SidebarToggle from "./SidebarToggle.vue";
import {computed, defineComponent, nextTick, onMounted, PropType, ref, watch} from "vue";
import {displayName, parseCommands, SavedNetwork} from "../js/irc/saved-networks";
import webpush from "../js/webpush";
import {useI18n} from "../js/i18n";
import type {SharedNetworkStatus} from "../../shared/types/network";

/** What the edit form binds to: a saved entry plus the live connection flag. */
export type NetworkFormDefaults = SavedNetwork & {
	connected?: boolean;
};

/** What the status button asks for; `connect` saves the form first. */
export type ConnectionAction = "connect" | "disconnect";

export default defineComponent({
	name: "NetworkForm",
	components: {
		RevealPassword,
		SidebarToggle,
	},
	props: {
		handleSubmit: {
			type: Function as PropType<(network: SavedNetwork) => void>,
			required: true,
		},
		defaults: {
			type: Object as PropType<NetworkFormDefaults>,
			required: true,
		},
		disabled: Boolean,
		embedded: Boolean,
		/** Live connection state; shows the status row when given. */
		status: {
			type: Object as PropType<SharedNetworkStatus | null>,
			default: null,
		},
		/** Connect / cancel / disconnect from the status row. */
		handleAction: {
			type: Function as PropType<(action: ConnectionAction, network: SavedNetwork) => void>,
			default: undefined,
		},
	},
	setup(props) {
		const {t} = useI18n();
		// Labels bound to attributes: computeds, so a locale change re-renders.
		const ariaEditLabel = computed(() => t("form.ariaEdit"));
		const namePlaceholder = computed(() => t("form.namePlaceholder"));
		const serverAddressLabel = computed(() => t("form.serverAddress"));
		const serverPortLabel = computed(() => t("form.serverPort"));
		const channelsPlaceholder = computed(() => t("form.channelsPlaceholder"));
		const commandsHelp = computed(() => t("form.commandsHelp"));
		const passwordPlaceholder = computed(() => t("form.passwordPlaceholder"));
		const pushHelp = computed(() => t("form.pushHelp"));
		const browserNotificationsHelp = computed(() => t("form.browserNotificationsHelp"));
		const commandsInput = ref<HTMLTextAreaElement | null>(null);
		const commandsText = ref((props.defaults.commands ?? []).join("\n"));

		// This device's push situation for the network being edited (reactive
		// over webpush's servers/subscriptions): `stale` — a subscription is
		// stored, but not for the key this server announces — offers Renew.
		const pushInfo = computed(() => webpush.networkPushInfo(props.defaults.uuid ?? ""));

		const renewPush = () => {
			if (props.defaults.uuid) {
				webpush.renew(props.defaults.uuid);
			}
		};

		/** The toggle itself is the user gesture: ask for the Notification
		 * permission the first time a network's browser notifications are
		 * switched on (only while the decision is still open). */
		const onNotifyToggle = () => {
			if (
				props.defaults.notifyEnabled &&
				typeof Notification !== "undefined" &&
				Notification.permission === "default"
			) {
				void Notification.requestPermission().catch(() => undefined);
			}
		};

		const resizeCommandsInput = () => {
			if (!commandsInput.value) {
				return;
			}

			// Reset height first so it can down size
			commandsInput.value.style.height = "";

			// 2 pixels to account for the border
			commandsInput.value.style.height = `${Math.ceil(
				commandsInput.value.scrollHeight + 2
			)}px`;
		};

		watch(
			() => props.defaults.commands,
			(commands) => {
				commandsText.value = (commands ?? []).join("\n");
				void nextTick(() => {
					resizeCommandsInput();
				});
			}
		);

		onMounted(() => {
			resizeCommandsInput();
		});

		// Keep the port on nefarious2's defaults while the TLS box is toggled.
		watch(
			() => props.defaults.tls,
			(isSecureChecked) => {
				const ports = [8067, 8443];
				const newPort = isSecureChecked ? 1 : 0;

				if (props.defaults.port === ports[1 - newPort]) {
					props.defaults.port = ports[newPort];
				}
			}
		);

		const formData = (): SavedNetwork => {
			const data: SavedNetwork = {
				...props.defaults,
				commands: parseCommands(commandsText.value),
			};
			delete (data as NetworkFormDefaults).connected;
			return data;
		};

		const onSubmit = () => {
			props.handleSubmit(formData());
		};

		const statusText = computed(() => {
			const s = props.status;

			if (!s) {
				return "";
			}

			if (s.connected) {
				return s.secure ? t("form.connectedTls") : t("form.connectedInsecure");
			}

			return s.connecting ? t("form.connecting") : t("form.disconnected");
		});

		const statusClass = computed(() =>
			props.status?.connected
				? "is-connected"
				: props.status?.connecting
				? "is-connecting"
				: "is-disconnected"
		);

		const actionLabel = computed(() =>
			props.status?.connected
				? t("form.actionDisconnect")
				: props.status?.connecting
				? t("form.actionCancel")
				: t("form.actionConnect")
		);

		const onAction = () => {
			const busy = !!(props.status?.connected || props.status?.connecting);
			props.handleAction?.(busy ? "disconnect" : "connect", formData());
		};

		return {
			t,
			ariaEditLabel,
			namePlaceholder,
			serverAddressLabel,
			serverPortLabel,
			channelsPlaceholder,
			commandsHelp,
			passwordPlaceholder,
			pushHelp,
			browserNotificationsHelp,
			pushInfo,
			renewPush,
			onNotifyToggle,
			commandsInput,
			commandsText,
			resizeCommandsInput,
			displayName,
			onSubmit,
			statusText,
			statusClass,
			actionLabel,
			onAction,
		};
	},
});
</script>
