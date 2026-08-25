<template>
	<div id="connect" class="window" role="tabpanel" aria-label="Edit network">
		<div class="header">
			<SidebarToggle />
		</div>
		<form class="container" method="post" action="" @submit.prevent="onSubmit">
			<h1 class="title">
				<input v-model="defaults.uuid" type="hidden" name="uuid" />
				Edit {{ displayName(defaults) }}
			</h1>

			<!--
				Only what `ConnectOptions` (client/js/irc/types.ts) and the saved
				network store support is offered. Dropped from TheLounge's form:
				server password, "only allow trusted certificates", SOCKS proxy,
				username / real name / leave message, SASL EXTERNAL (client
				certificates) and the STS lock — none of them apply to a browser
				WebSocket connection, or they wait on later phases (STS: D.6).
			-->
			<h2>Network settings</h2>
			<div class="connect-row">
				<label for="connect:name">Name</label>
				<input
					id="connect:name"
					v-model.trim="defaults.name"
					class="input"
					name="name"
					maxlength="100"
					placeholder="Optional, defaults to the server's network name"
				/>
			</div>
			<div class="connect-row">
				<label for="connect:host">Server</label>
				<div class="input-wrap">
					<input
						id="connect:host"
						v-model.trim="defaults.host"
						class="input"
						name="host"
						aria-label="Server address"
						maxlength="255"
						required
					/>
					<span id="connect:portseparator">:</span>
					<input
						id="connect:port"
						v-model.number="defaults.port"
						class="input"
						type="number"
						min="1"
						max="65535"
						name="port"
						aria-label="Server port"
						required
					/>
				</div>
			</div>
			<div class="connect-row">
				<label></label>
				<div class="input-wrap">
					<label class="tls">
						<input v-model="defaults.tls" type="checkbox" name="tls" />
						Use secure connection (TLS)
					</label>
					<label class="tls">
						<input v-model="defaults.autoconnect" type="checkbox" name="autoconnect" />
						Connect automatically when the app starts
					</label>
				</div>
			</div>
			<div v-if="defaults.connected" class="connect-note">
				Server, port, TLS, channels and authentication changes apply the next time this
				network connects.
			</div>

			<h2>User preferences</h2>
			<div class="connect-row">
				<label for="connect:nick">Nick</label>
				<input
					id="connect:nick"
					v-model.trim="defaults.nick"
					class="input nick"
					name="nick"
					pattern="[^\s:!@]+"
					maxlength="100"
					required
				/>
			</div>
			<div class="connect-row">
				<label for="connect:channels">Channels</label>
				<input
					id="connect:channels"
					v-model.trim="defaults.join"
					class="input"
					name="join"
					placeholder="#channel, #another key (joined on connect)"
				/>
			</div>
			<div class="connect-row">
				<label for="connect:commands">
					Commands
					<span
						class="tooltipped tooltipped-ne tooltipped-no-delay"
						aria-label="One /command per line.
Each command will be executed in
the server tab on new connection"
					>
						<button class="extra-help" type="button" />
					</span>
				</label>
				<textarea
					id="connect:commands"
					ref="commandsInput"
					v-model="commandsText"
					autocomplete="off"
					class="input"
					name="commands"
					@input="resizeCommandsInput"
				/>
			</div>

			<h2 id="label-auth">Authentication</h2>
			<div class="connect-row connect-auth" role="group" aria-labelledby="label-auth">
				<label class="opt">
					<input v-model="defaults.sasl" type="radio" name="sasl" value="" />
					No authentication
				</label>
				<label class="opt">
					<input v-model="defaults.sasl" type="radio" name="sasl" value="plain" />
					Username + password (SASL PLAIN)
				</label>
			</div>

			<template v-if="defaults.sasl === 'plain'">
				<div class="connect-row">
					<label for="connect:saslAccount">Account</label>
					<input
						id="connect:saslAccount"
						v-model.trim="defaults.saslAccount"
						class="input"
						name="saslAccount"
						maxlength="100"
						autocomplete="username"
						required
					/>
				</div>
				<div class="connect-row">
					<label for="connect:saslPassword">Password</label>
					<RevealPassword
						v-slot:default="slotProps"
						class="input-wrap password-container"
					>
						<input
							id="connect:saslPassword"
							v-model="defaults.saslPassword"
							class="input"
							:type="slotProps.isVisible ? 'text' : 'password'"
							name="saslPassword"
							maxlength="300"
							autocomplete="current-password"
							placeholder="Leave empty to keep the current password"
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
							Remember password on this device
						</label>
					</div>
				</div>
			</template>

			<div>
				<button type="submit" class="btn" :disabled="disabled ? true : false">
					Save network
				</button>
			</div>
		</form>
	</div>
</template>

<style>
#connect .connect-auth {
	display: block;
	margin-bottom: 10px;
}

#connect .connect-auth .opt {
	display: block;
	width: 100%;
}

#connect .connect-auth input {
	margin: 3px 10px 0 0;
}

#connect .connect-note {
	padding: 10px;
	margin: 10px 0;
	border-radius: 2px;
	background-color: #d9edf7;
	color: #31708f;
}
</style>

<script lang="ts">
import RevealPassword from "./RevealPassword.vue";
import SidebarToggle from "./SidebarToggle.vue";
import {defineComponent, nextTick, onMounted, PropType, ref, watch} from "vue";
import {displayName, parseCommands, SavedNetwork} from "../js/irc/saved-networks";

/** What the edit form binds to: a saved entry plus the live connection flag. */
export type NetworkFormDefaults = SavedNetwork & {
	connected?: boolean;
};

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
	},
	setup(props) {
		const commandsInput = ref<HTMLTextAreaElement | null>(null);
		const commandsText = ref((props.defaults.commands ?? []).join("\n"));

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

		const onSubmit = () => {
			const data: SavedNetwork = {
				...props.defaults,
				commands: parseCommands(commandsText.value),
			};
			delete (data as NetworkFormDefaults).connected;
			props.handleSubmit(data);
		};

		return {
			commandsInput,
			commandsText,
			resizeCommandsInput,
			displayName,
			onSubmit,
		};
	},
});
</script>
