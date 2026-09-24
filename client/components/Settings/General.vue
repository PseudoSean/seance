<template>
	<div>
		<div v-if="canRegisterProtocol || store.state.installPromptAvailable">
			<h2>{{ t("settings.general.nativeApp") }}</h2>
			<button
				v-if="store.state.installPromptAvailable"
				type="button"
				class="btn"
				@click.prevent="nativeInstallPrompt"
			>
				{{ t("settings.general.installApp", {appName}) }}
			</button>
			<button
				v-if="canRegisterProtocol"
				type="button"
				class="btn"
				@click.prevent="registerProtocol"
			>
				{{ t("settings.general.openLinks", {appName}) }}
			</button>
		</div>
		<div v-if="store.state.serverConfiguration?.fileUpload">
			<h2>{{ t("settings.general.uploadsHeading") }}</h2>
			<div>
				<label class="opt">
					<input
						:checked="store.state.settings.uploadCanvas"
						type="checkbox"
						name="uploadCanvas"
					/>
					{{ t("settings.general.uploadCanvas") }}
					<span
						class="tooltipped tooltipped-n tooltipped-no-delay"
						:aria-label="uploadCanvasHelp"
					>
						<button class="extra-help" />
					</span>
				</label>
			</div>
		</div>
		<div>
			<h2>{{ t("settings.general.typingHeading") }}</h2>
			<div>
				<label class="opt">
					<input
						:checked="store.state.settings.sendTypingNotifications"
						type="checkbox"
						name="sendTypingNotifications"
					/>
					{{ t("settings.general.sendTyping") }}
					<span
						class="tooltipped tooltipped-n tooltipped-no-delay"
						:aria-label="sendTypingHelp"
					>
						<button class="extra-help" />
					</span>
				</label>
			</div>
		</div>
		<div v-if="!store.state.serverConfiguration?.public">
			<h2>{{ t("settings.general.awayHeading") }}</h2>

			<label class="opt">
				<label for="awayMessage" class="sr-only">{{
					t("settings.general.awayHeading")
				}}</label>
				<input
					id="awayMessage"
					dir="auto"
					:value="store.state.settings.awayMessage"
					type="text"
					name="awayMessage"
					class="input"
					:placeholder="awayPlaceholder"
				/>
			</label>
		</div>
		<div class="settings-backup">
			<h2>{{ t("settings.general.backupHeading") }}</h2>
			<p>{{ t("settings.general.backupIntro") }}</p>
			<label class="opt">
				<input v-model="includePasswords" type="checkbox" />
				{{ t("settings.general.includePasswords") }}
				<span
					class="tooltipped tooltipped-n tooltipped-no-delay"
					:aria-label="includePasswordsHelp"
				>
					<button class="extra-help" />
				</span>
			</label>
			<div class="opt">
				<button type="button" class="btn" :disabled="busy" @click.prevent="download">
					{{ t("settings.general.export") }}
				</button>
				<button type="button" class="btn" :disabled="busy" @click.prevent="pickFile">
					{{ t("settings.general.import") }}
				</button>
				<input
					ref="fileInput"
					type="file"
					class="sr-only"
					:aria-label="fileAriaLabel"
					:accept="`${fileExtension},application/json`"
					@change="onFileChosen"
				/>
			</div>
			<p v-if="error" class="settings-backup-error" role="alert">{{ error }}</p>
		</div>
	</div>
</template>

<style>
#settings .settings-backup p {
	color: var(--body-color-muted);
}

#settings .settings-backup .settings-backup-error {
	padding: 0.5em 0.75em;
	border-radius: 0.25em;
	color: var(--error-fg, #a94442);
	background-color: var(--error-bg, #f2dede);
}
</style>

<script lang="ts">
import {computed, defineComponent, onMounted, ref} from "vue";
import {useStore} from "../../js/store";
import {useI18n} from "../../js/i18n";
import {promptInstall} from "../../js/pwa";
import eventbus from "../../js/eventbus";
import {
	applyBackup,
	BackupFormatError,
	BackupFormatErrorCode,
	collectBackup,
	decodeBackup,
	encodeBackup,
	FILE_EXTENSION,
	fileName,
	hasPasswords,
	networkCount,
	SettingsBackup,
} from "../../js/helpers/settingsBackup";

export default defineComponent({
	name: "GeneralSettings",
	setup() {
		const store = useStore();
		const {t, tCount, locale} = useI18n();
		const appName = computed(() => store.state.branding.appName);
		const uploadCanvasHelp = computed(() => t("settings.general.uploadCanvasHelp"));
		const sendTypingHelp = computed(() => t("settings.general.sendTypingHelp"));
		const awayPlaceholder = computed(() =>
			t("settings.general.awayPlaceholder", {appName: appName.value})
		);
		const includePasswordsHelp = computed(() => t("settings.general.includePasswordsHelp"));
		const fileAriaLabel = computed(() => t("settings.general.fileAria"));
		const canRegisterProtocol = ref(false);

		onMounted(() => {
			// Enable protocol handler registration if supported,
			// and the network configuration is not locked
			canRegisterProtocol.value =
				!!window.navigator.registerProtocolHandler &&
				!store.state.serverConfiguration?.lockNetwork;
		});

		const nativeInstallPrompt = () => {
			// The store flag (and so the button) clears as soon as the prompt
			// is shown; Chrome fires a new beforeinstallprompt if dismissed.
			void promptInstall();
		};

		// `web+irc:`, not `irc:`/`ircs:`: those promise a TCP connection we
		// cannot make, and a web app may only claim `web+…` schemes anyway
		// (docs/resources/irc-links.md).
		const registerProtocol = () => {
			const uri = document.location.origin + document.location.pathname + "?uri=%s";
			// @ts-expect-error
			// the third argument is deprecated but recommended for compatibility: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/registerProtocolHandler
			window.navigator.registerProtocolHandler("web+irc", uri, appName.value);
		};

		// Settings backup (helpers/settingsBackup.ts). The download is a
		// gzipped JSON file; a restore replaces every covered localStorage
		// entry and reloads, which is how every module re-reads its storage.
		const includePasswords = ref(false);
		const busy = ref(false);
		const error = ref("");
		const fileInput = ref<HTMLInputElement>();

		const download = async () => {
			error.value = "";
			busy.value = true;

			try {
				const backup = collectBackup({
					includePasswords: includePasswords.value,
					settings: {...store.state.settings},
					app: appName.value,
				});
				const bytes = await encodeBackup(backup);
				const blob = new Blob([bytes as BlobPart], {type: "application/octet-stream"});
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = fileName(appName.value);
				document.body.appendChild(link);
				link.click();
				link.remove();
				// Revoke after the click has had its turn at the URL.
				setTimeout(() => URL.revokeObjectURL(url), 10_000);
			} catch (e) {
				error.value = t("settings.general.exportFailed");
			} finally {
				busy.value = false;
			}
		};

		const pickFile = () => {
			error.value = "";
			fileInput.value?.click();
		};

		/** The day the file was made, in the reader's language — or "" when
		 * the envelope carries no usable date (it is optional, and a hand-made
		 * file can hold anything). */
		const exportedOn = (backup: SettingsBackup): string => {
			if (!backup.exportedAt) {
				return "";
			}

			const when = new Date(backup.exportedAt);

			if (Number.isNaN(when.getTime())) {
				return "";
			}

			return new Intl.DateTimeFormat(locale.value, {dateStyle: "long"}).format(when);
		};

		const describe = (backup: SettingsBackup, name: string) => {
			const networks = networkCount(backup);
			const parts = [
				t("settings.general.backupPartSettings"),
				tCount("settings.general.backupNetworks", networks),
				t("settings.general.backupMutes"),
			];
			// Two whole sentences the dialog may add after the frame's: what
			// the file carries that the reader should know about, and when it
			// was made. The warning went missing when the dialog was
			// localized (the variable was kept and its use was not), and the
			// date sentence went with it. The separating space belongs here,
			// not to the copy: every catalog is a whole sentence of its own.
			// `.trim()` guards a translation that padded itself anyway.
			const sentences = [
				t("settings.general.backupFrame", {parts: parts.join(", "), file: name}),
			];

			if (hasPasswords(backup)) {
				sentences.push(t("settings.general.backupPasswords"));
			}

			const exported = exportedOn(backup);

			if (exported) {
				sentences.push(t("settings.general.backupExported", {date: exported}));
			}

			return sentences.map((sentence) => sentence.trim()).join(" ");
		};

		const restore = (backup: SettingsBackup, name: string) => {
			eventbus.emit(
				"confirm-dialog",
				{
					title: t("settings.general.importTitle"),
					text: describe(backup, name),
					button: t("settings.general.importButton"),
				},
				(confirmed: boolean) => {
					if (!confirmed) {
						return;
					}

					// Nothing runs between the write and the reload, so no
					// in-memory state can overwrite the file's entries.
					applyBackup(backup);
					window.location.reload();
				}
			);
		};

		/** The reader-visible wording for a refused backup file: the Vue-free
		 * module carries stable codes, this is where they become copy. */
		const importErrorText = (code: BackupFormatErrorCode): string => {
			switch (code) {
				case "newer-version":
					return t("settings.general.importNewer");
				case "damaged":
					return t("settings.general.importDamaged");
				case "no-decompression":
					return t("settings.general.importNoDecompression");
				default:
					return t("settings.general.importNotSettings");
			}
		};

		const onFileChosen = async (event: Event) => {
			const input = event.target as HTMLInputElement;
			const file = input.files?.[0];
			input.value = ""; // so choosing the same file again fires change

			if (!file) {
				return;
			}

			busy.value = true;

			try {
				const backup = await decodeBackup(new Uint8Array(await file.arrayBuffer()));
				restore(backup, file.name);
			} catch (e) {
				error.value =
					e instanceof BackupFormatError
						? importErrorText(e.code)
						: t("settings.general.importFailed");
			} finally {
				busy.value = false;
			}
		};

		return {
			appName,
			store,
			t,
			uploadCanvasHelp,
			sendTypingHelp,
			awayPlaceholder,
			includePasswordsHelp,
			fileAriaLabel,
			canRegisterProtocol,
			nativeInstallPrompt,
			registerProtocol,
			includePasswords,
			busy,
			error,
			fileInput,
			fileExtension: FILE_EXTENSION,
			download,
			pickFile,
			onFileChosen,
		};
	},
});
</script>
