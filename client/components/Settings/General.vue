<template>
	<div>
		<div v-if="canRegisterProtocol || hasInstallPromptEvent">
			<h2>Native app</h2>
			<button
				v-if="hasInstallPromptEvent"
				type="button"
				class="btn"
				@click.prevent="nativeInstallPrompt"
			>
				Add {{ appName }} to Home screen
			</button>
			<button
				v-if="canRegisterProtocol"
				type="button"
				class="btn"
				@click.prevent="registerProtocol"
			>
				Open irc:// URLs with {{ appName }}
			</button>
		</div>
		<div v-if="store.state.serverConfiguration?.fileUpload">
			<h2>File uploads</h2>
			<div>
				<label class="opt">
					<input
						:checked="store.state.settings.uploadCanvas"
						type="checkbox"
						name="uploadCanvas"
					/>
					Attempt to remove metadata from images before uploading
					<span
						class="tooltipped tooltipped-n tooltipped-no-delay"
						aria-label="This option renders the image into a canvas element to remove metadata from the image.
	This may break orientation if your browser does not support that."
					>
						<button class="extra-help" />
					</span>
				</label>
			</div>
		</div>
		<div>
			<h2>Typing notifications</h2>
			<div>
				<label class="opt">
					<input
						:checked="store.state.settings.sendTypingNotifications"
						type="checkbox"
						name="sendTypingNotifications"
					/>
					Send typing notifications
					<span
						class="tooltipped tooltipped-n tooltipped-no-delay"
						aria-label="Lets people in the channel see when you are typing (IRCv3 +typing)."
					>
						<button class="extra-help" />
					</span>
				</label>
			</div>
		</div>
		<div v-if="!store.state.serverConfiguration?.public">
			<h2>Automatic away message</h2>

			<label class="opt">
				<label for="awayMessage" class="sr-only">Automatic away message</label>
				<input
					id="awayMessage"
					:value="store.state.settings.awayMessage"
					type="text"
					name="awayMessage"
					class="input"
					:placeholder="`Away message if ${appName} is not open`"
				/>
			</label>
		</div>
	</div>
</template>

<style></style>

<script lang="ts">
import {computed, defineComponent, onMounted, ref} from "vue";
import {useStore} from "../../js/store";
import {BeforeInstallPromptEvent} from "../../js/types";

let installPromptEvent: BeforeInstallPromptEvent | null = null;

window.addEventListener("beforeinstallprompt", (e) => {
	e.preventDefault();
	installPromptEvent = e as BeforeInstallPromptEvent;
});

export default defineComponent({
	name: "GeneralSettings",
	setup() {
		const store = useStore();
		const appName = computed(() => store.state.branding.appName);
		const canRegisterProtocol = ref(false);

		const hasInstallPromptEvent = computed(() => {
			// TODO: This doesn't hide the button after clicking
			return installPromptEvent !== null;
		});

		onMounted(() => {
			// Enable protocol handler registration if supported,
			// and the network configuration is not locked
			canRegisterProtocol.value =
				!!window.navigator.registerProtocolHandler &&
				!store.state.serverConfiguration?.lockNetwork;
		});

		const nativeInstallPrompt = () => {
			if (!installPromptEvent) {
				return;
			}

			installPromptEvent.prompt().catch((e) => {
				// eslint-disable-next-line no-console
				console.error(e);
			});

			installPromptEvent = null;
		};

		const registerProtocol = () => {
			const uri = document.location.origin + document.location.pathname + "?uri=%s";
			// @ts-expect-error
			// the third argument is deprecated but recommended for compatibility: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/registerProtocolHandler
			window.navigator.registerProtocolHandler("irc", uri, appName.value);
			// @ts-expect-error
			window.navigator.registerProtocolHandler("ircs", uri, appName.value);
		};

		return {
			appName,
			store,
			canRegisterProtocol,
			hasInstallPromptEvent,
			nativeInstallPrompt,
			registerProtocol,
		};
	},
});
</script>
