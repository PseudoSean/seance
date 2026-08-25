<template>
	<div id="connect" class="window" role="tabpanel" aria-label="Connect">
		<div class="header">
			<SidebarToggle />
		</div>
		<form class="container" method="post" action="" @submit.prevent="onSubmit">
			<h1 class="title">Connect to IRC</h1>

			<h2>Server</h2>
			<div class="connect-row">
				<label for="connect:host">Server</label>
				<div class="input-wrap">
					<input
						id="connect:host"
						v-model.trim="form.host"
						class="input"
						name="host"
						aria-label="Server address"
						placeholder="irc.example.org"
						maxlength="255"
						required
					/>
					<span id="connect:portseparator">:</span>
					<input
						id="connect:port"
						v-model.number="form.port"
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
						<input v-model="form.tls" type="checkbox" name="tls" />
						Use secure connection (TLS)
					</label>
				</div>
			</div>

			<h2>User</h2>
			<div class="connect-row">
				<label for="connect:nick">Nick</label>
				<input
					id="connect:nick"
					v-model.trim="form.nick"
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
					v-model.trim="form.join"
					class="input"
					name="join"
					placeholder="#channel, #another (optional)"
				/>
			</div>

			<h2 id="label-auth">Authentication</h2>
			<div class="connect-row">
				<label></label>
				<div class="input-wrap">
					<label class="tls">
						<input v-model="showSasl" type="checkbox" name="sasl" />
						I have a services account (SASL)
					</label>
				</div>
			</div>
			<template v-if="showSasl">
				<div class="connect-row">
					<label for="connect:saslAccount">Account</label>
					<input
						id="connect:saslAccount"
						v-model.trim="form.saslAccount"
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
							v-model="form.saslPassword"
							class="input"
							:type="slotProps.isVisible ? 'text' : 'password'"
							name="saslPassword"
							maxlength="300"
							autocomplete="current-password"
							required
						/>
					</RevealPassword>
				</div>
			</template>

			<div v-if="submitted" class="connect-notice">
				Connecting as <strong>{{ submitted.nick }}</strong> to
				<strong>{{ submitted.host }}:{{ submitted.port }}</strong
				>…
			</div>

			<div>
				<button type="submit" class="btn">Connect</button>
			</div>
		</form>
	</div>
</template>

<style>
#connect .connect-notice {
	padding: 10px;
	margin-bottom: 10px;
	border-radius: 2px;
	background-color: #d9edf7;
	color: #31708f;
}
</style>

<script lang="ts">
import {defineComponent, onMounted, reactive, ref, watch} from "vue";

import {useStore} from "../../js/store";
import {createNetwork} from "../../js/irc/manager";
import type {ConnectOptions} from "../../js/irc/types";
import RevealPassword from "../RevealPassword.vue";
import SidebarToggle from "../SidebarToggle.vue";

export type {ConnectOptions};

/** nefarious2's WebSocket ports: 8443 for wss://, 8067 for ws://. */
function defaultPort(tls: boolean): number {
	return tls ? 8443 : 8067;
}

export default defineComponent({
	name: "Connect",
	components: {
		RevealPassword,
		SidebarToggle,
	},
	props: {
		queryParams: Object,
	},
	setup(props) {
		const store = useStore();
		const defaults = store.state.serverConfiguration?.defaults;

		const tls = defaults?.tls ?? true;
		const form = reactive<ConnectOptions>({
			host: defaults?.host || "",
			// 6697 is TheLounge's plain-IRC default; not meaningful over WebSocket.
			port: defaults?.port && defaults.port !== 6697 ? defaults.port : defaultPort(tls),
			tls,
			nick: defaults?.nick || "",
			join: defaults?.join || "",
			sasl: defaults?.sasl === "plain" ? "plain" : "",
			saslAccount: defaults?.saslAccount || "",
			saslPassword: defaults?.saslPassword || "",
		});

		applyQueryParams(form, props.queryParams);

		// Follow the TLS checkbox while the port is still one of the defaults.
		watch(
			() => form.tls,
			(useTls) => {
				if (form.port === defaultPort(!useTls)) {
					form.port = defaultPort(useTls);
				}
			}
		);

		const showSasl = ref(form.sasl === "plain" || !!form.saslAccount);
		const submitted = ref<ConnectOptions | null>(null);

		const onSubmit = () => {
			form.sasl = showSasl.value ? "plain" : "";

			if (!showSasl.value) {
				form.saslAccount = "";
				form.saslPassword = "";
			}

			submitted.value = {...form};
			createNetwork(submitted.value);
		};

		onMounted(() => {
			// `?autoconnect=1` with a host and nick skips the form entirely.
			if (isTruthyParam(props.queryParams?.autoconnect) && form.host && form.nick) {
				onSubmit();
			}
		});

		return {
			form,
			showSasl,
			submitted,
			onSubmit,
		};
	},
});

function isTruthyParam(value: unknown): boolean {
	if (Array.isArray(value)) {
		value = value[0];
	}

	return value === "" || value === "1" || value === "true" || value === true;
}

/**
 * Pre-fill the form from `?host=...&nick=...` style URL parameters or the
 * output of `parseIrcUri` for `irc://` links. `channels` is accepted as an
 * alias for `join` for compatibility with other clients.
 */
function applyQueryParams(form: ConnectOptions, params?: Record<string, any>) {
	if (!params) {
		return;
	}

	const first = (value: unknown): string | undefined => {
		if (Array.isArray(value)) {
			value = value[0];
		}

		return value === undefined || value === null ? undefined : String(value);
	};

	const host = first(params.host);
	const port = first(params.port);
	const tls = first(params.tls);
	const nick = first(params.nick);
	const join = first(params.join ?? params.channels);
	const saslAccount = first(params.saslAccount);
	const saslPassword = first(params.saslPassword);

	if (host) {
		form.host = host;
	}

	if (port && !Number.isNaN(Number(port))) {
		form.port = Number(port);
	}

	if (tls !== undefined) {
		form.tls = !(tls === "0" || tls === "false");
	}

	if (nick) {
		form.nick = nick;
	}

	if (join) {
		form.join = join
			.split(",")
			.map((chan) => chan.trim())
			.filter((chan) => chan.length > 0)
			.map((chan) => (chan.match(/^[#&!+]/) ? chan : `#${chan}`))
			.join(", ");
	}

	if (saslAccount) {
		form.saslAccount = saslAccount;
		form.sasl = "plain";
	}

	if (saslPassword) {
		form.saslPassword = saslPassword;
	}
}
</script>
