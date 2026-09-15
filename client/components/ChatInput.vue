<template>
	<form id="form" method="post" action="" @submit.prevent="onSubmit()">
		<TypingIndicator :channel="channel" />
		<div v-if="showConnectionBar" class="connection-bar" role="status" aria-live="polite">
			<span
				:class="[
					'connection-bar-icon',
					{spinning: network.status.connecting && retryInSeconds === 0},
				]"
				aria-hidden="true"
			></span>
			<span class="connection-bar-label">{{ connectionLabel }}</span>
			<button
				v-if="canConnectNow"
				type="button"
				class="connection-bar-connect"
				@click="connectNetwork"
			>
				{{ network.status.connecting ? t("composer.connectNow") : t("composer.connect") }}
			</button>
		</div>
		<div
			v-if="store.state.uploadProgress"
			class="upload-bar"
			role="status"
			aria-live="polite"
			:aria-label="uploadLabel"
		>
			<span class="upload-bar-label">
				<span class="upload-bar-icon" aria-hidden="true"></span>
				{{ uploadLabel }}
			</span>
			<span :class="['upload-bar-track', {indeterminate: uploadPercent === null}]">
				<span
					class="upload-bar-fill"
					:style="{width: (uploadPercent === null ? 100 : uploadPercent) + '%'}"
				></span>
			</span>
			<span class="upload-bar-percent">{{
				uploadPercent === null ? "" : uploadPercent + "%"
			}}</span>
			<button
				type="button"
				class="compose-bar-cancel"
				:aria-label="cancelUploadLabel"
				:title="cancelUploadLabel"
				@click="cancelUpload"
			>
				✕
			</button>
		</div>
		<div v-if="channel.editing || channel.replyTo" class="compose-bar" role="status">
			<span v-if="channel.editing" class="compose-bar-label">
				<span class="compose-bar-icon" aria-hidden="true">✎</span>
				{{ t("composer.editing") }}
				<span class="compose-bar-preview">{{ composePreview }}</span>
			</span>
			<span v-else class="compose-bar-label">
				<span class="compose-bar-icon" aria-hidden="true">↩</span>
				{{ replyingParts.prefix
				}}<strong v-if="replyingParts.nick" class="compose-bar-nick">{{
					replyingParts.nick
				}}</strong
				>{{ replyingParts.suffix }}
				<span class="compose-bar-preview">{{ composePreview }}</span>
			</span>
			<button
				type="button"
				class="compose-bar-cancel"
				:aria-label="cancelComposeLabel"
				:title="cancelComposeTitle"
				@click="cancelCompose(channel)"
			>
				✕
			</button>
		</div>
		<div
			v-if="outgoing"
			:class="['translate-bar', {failed: outgoing.status === 'failed'}]"
			role="status"
			aria-live="polite"
		>
			<div class="translate-bar-row">
				<span class="translate-bar-chip" :title="outgoingChipTitle">{{
					outgoingChip
				}}</span>
				<span
					v-if="outgoing.status === 'failed'"
					class="translate-bar-text translate-bar-failed"
					>couldn't translate, send as written?<span
						v-if="outgoing.error"
						class="translate-bar-reason"
						:title="outgoing.error"
						>{{ shortReason(outgoing.error) }}</span
					></span
				>
				<span v-else class="translate-bar-text" dir="auto" :lang="outgoing.to"
					>{{ outgoing.text
					}}<span v-if="outgoingDownload" class="translate-bar-download">{{
						outgoingDownload
					}}</span
					><span
						v-if="outgoing.status === 'pending'"
						class="translate-bar-caret"
						aria-hidden="true"
					></span
				></span>
				<span class="translate-bar-actions">
					<button
						v-if="outgoing.status === 'done'"
						type="button"
						:class="[
							'translate-bar-button',
							'translate-bar-copy',
							{'translate-bar-copy-done': copiedOutgoing},
						]"
						:title="copiedOutgoing ? 'Copied' : 'Copy the translation'"
						:aria-label="copiedOutgoing ? 'Copied' : 'Copy the translation'"
						@mousedown.prevent
						@click="copyOutgoing"
					/>
					<button
						type="button"
						class="translate-bar-button translate-bar-send"
						:disabled="outgoingBusy || !canSend"
						:title="
							outgoing.status === 'failed'
								? 'Send as written'
								: 'Send the translation'
						"
						:aria-label="
							outgoing.status === 'failed'
								? 'Send as written'
								: 'Send the translation'
						"
						@mousedown.prevent
						@click="onSubmit()"
					/>
					<button
						type="button"
						class="translate-bar-button translate-bar-edit"
						title="Keep typing (Escape)"
						aria-label="Keep typing (Escape)"
						@mousedown.prevent
						@click="cancelOutgoingNow"
					/>
				</span>
			</div>
			<div
				v-if="outgoing.check.status !== 'idle'"
				class="translate-bar-row translate-bar-check"
			>
				<span class="translate-bar-check-label">{{ outgoingCheckLabel }}</span>
				<span v-if="outgoing.check.status === 'failed'" class="translate-bar-failed"
					>couldn't check</span
				>
				<span
					v-else
					class="translate-bar-text"
					dir="auto"
					:lang="outgoing.check.to ?? undefined"
					>{{ outgoing.check.text
					}}<span
						v-if="outgoing.check.status === 'pending'"
						class="translate-bar-caret"
						aria-hidden="true"
					></span
				></span>
			</div>
		</div>
		<span id="nick">{{ network.nick }}</span>
		<label for="input" class="sr-only">{{ t("composer.inputLabel") }}</label>
		<textarea
			id="input"
			ref="input"
			dir="auto"
			class="mousetrap"
			enterkeyhint="send"
			autocomplete="off"
			:value="channel.pendingMessage"
			:placeholder="getInputPlaceholder(channel)"
			@input="setPendingMessage"
			@keypress.enter.exact="onEnterKey"
			@blur="onBlur"
		/>
		<span
			v-if="store.state.serverConfiguration?.fileUpload"
			id="upload-tooltip"
			class="tooltipped tooltipped-w tooltipped-no-touch"
			:aria-label="uploadFileLabel"
			@click="openFileUpload"
		>
			<input
				id="upload-input"
				ref="uploadInput"
				type="file"
				aria-labelledby="upload"
				multiple
				:accept="uploadAccept"
				@change="onUploadInputChange"
			/>
			<button
				id="upload"
				type="button"
				:aria-label="uploadFileLabel"
				:disabled="!network.status.connected"
			/>
		</span>
		<span
			id="submit-tooltip"
			class="tooltipped tooltipped-w tooltipped-no-touch"
			:data-tooltip="sendTooltip"
		>
			<!-- `mousedown.prevent` keeps focus in the textarea: a tap that blurs
			it drops the keyboard, the viewport grows and the button moves out
			from under the finger before the click lands. -->
			<button
				id="submit"
				type="submit"
				:aria-label="sendLabel"
				:disabled="!canSend || outgoingBusy"
				@mousedown.prevent
			/>
		</span>
	</form>
</template>

<script lang="ts">
import Mousetrap from "mousetrap";
import {wrapCursor} from "undate";
import autocompletion from "../js/autocompletion";
import {commands} from "../js/commands/index";
import {writeClipboard} from "../js/clipboard";
import {expandAlias} from "../js/helpers/aliases";
import socket from "../js/socket";
import upload from "../js/upload";
import eventbus from "../js/eventbus";
import {
	watch,
	computed,
	defineComponent,
	nextTick,
	onMounted,
	PropType,
	ref,
	onUnmounted,
} from "vue";
import type {ClientNetwork, ClientChan} from "../js/types";
import {useStore} from "../js/store";
import {ChanType} from "../../shared/types/chan";
import {
	cancelCompose,
	findEditableAfter,
	findEditableBefore,
	findLastEditable,
	startEdit,
} from "../js/helpers/compose";
import {hasVirtualKeyboard} from "../js/helpers/device";
import {useI18n} from "../js/i18n";
import {languageName} from "../js/translate/languages";
import {draftGate} from "../js/translate/outgoing";
import {readingLanguage} from "../js/translate/reader";
import {loadNote} from "../js/translate/service";
import {
	cancelOutgoing,
	noteOutgoingSent,
	recordSentReadBack,
	translateOutgoing,
	writeTarget,
} from "../js/translate/writer";

/** How long after a Return its late-arriving newline is still recognised. */
const ENTER_NEWLINE_WINDOW_MS = 500;

/** Characters of a failure reason the strip shows; the title has all of it. */
const REASON_MAX = 120;

/** How long the strip's Copy button reads "Copied" after a successful copy. */
const COPIED_LABEL_MS = 2000;
import {TypingReporter} from "../js/helpers/typingReporter";
import TypingIndicator from "./TypingIndicator.vue";

const formattingHotkeys = {
	"mod+k": "\x03",
	"mod+b": "\x02",
	"mod+u": "\x1F",
	"mod+i": "\x1D",
	"mod+o": "\x0F",
	"mod+s": "\x1e",
	"mod+m": "\x11",
};

// Autocomplete bracket and quote characters like in a modern IDE
// For example, select `text`, press `[` key, and it becomes `[text]`
const bracketWraps = {
	'"': '"',
	"'": "'",
	"(": ")",
	"<": ">",
	"[": "]",
	"{": "}",
	"*": "*",
	"`": "`",
	"~": "~",
	_: "_",
};

export default defineComponent({
	name: "ChatInput",
	components: {TypingIndicator},
	props: {
		network: {type: Object as PropType<ClientNetwork>, required: true},
		channel: {type: Object as PropType<ClientChan>, required: true},
	},
	setup(props) {
		const store = useStore();
		const {t, tCount} = useI18n();
		const input = ref<HTMLTextAreaElement>();
		const uploadInput = ref<HTMLInputElement>();
		const autocompletionRef = ref<ReturnType<typeof autocompletion>>();

		/**
		 * Until when an `input` event holding nothing but newlines is the
		 * Return that already sent (see onEnterKey). iOS applies that Return
		 * some 70 ms after the keypress, into a composer the send has emptied;
		 * left there, the next message goes out as a multiline batch with an
		 * empty first line (ERR_NOTEXTTOSEND).
		 */
		let enterNewlineDeadline = 0;

		/**
		 * Plain assignment on purpose. iOS's stuck shift key (see onEnterKey)
		 * is not fixable from here: focus(), blur()+focus(), a deferred clear,
		 * execCommand("delete") and setRangeText were all tried.
		 */
		const clearInput = () => {
			if (input.value) {
				input.value.value = "";
			}
		};

		const setInputSize = () => {
			void nextTick(() => {
				if (!input.value) {
					return;
				}

				const style = window.getComputedStyle(input.value);
				const lineHeight = parseFloat(style.lineHeight) || 1;

				// Measuring means collapsing the box to one line first, since
				// scrollHeight never shrinks below the box. Hold the form's height
				// meanwhile: the list above is sized by it, and WebKit clamps the
				// list's scroll position to the taller box it sees during that
				// moment, leaving the newest rows under the composer afterwards.
				const form = input.value.form!;

				form.style.minHeight = `${form.offsetHeight}px`;
				input.value.style.height = "";

				// scrollHeight is an integer and the line height is 1.4 × the font
				// size, fractional at every font step but the default: two lines of
				// 22.4px report 45, and ceil would give a third, blank line. Round.
				input.value.style.height = `${
					Math.round(input.value.scrollHeight / lineHeight) * lineHeight
				}px`;
				form.style.minHeight = "";
			});
		};

		// Own typing activity → client→server `typing` (bus-contract §1.5).
		// The reporter tracks what was announced and the 5 s idle timer; the
		// IRC layer throttles to the spec's 3 s rule. Never for the lobby, and
		// silenced entirely by the sendTypingNotifications setting.
		const typing = new TypingReporter((target, state) => {
			if (store.state.settings.sendTypingNotifications) {
				socket.emit("typing", {target, state});
			}
		});

		const reportTyping = () => {
			if (props.channel.type !== ChanType.LOBBY) {
				typing.input(props.channel.id, props.channel.pendingMessage);
			}
		};

		const setPendingMessage = (e: Event) => {
			const el = e.target as HTMLTextAreaElement;

			// The Return that already sent, or translated, landing late (see onEnterKey).
			if (
				enterNewlineDeadline > performance.now() &&
				(/^\n+$/.test(el.value) || el.value === `${props.channel.pendingMessage}\n`)
			) {
				enterNewlineDeadline = 0;
				el.value = props.channel.pendingMessage;
				setInputSize();
				return;
			}

			enterNewlineDeadline = 0;

			props.channel.pendingMessage = el.value;
			props.channel.inputHistoryPosition = 0;
			props.channel.editDismissed = false; // typing re-arms ArrowUp-to-edit
			setInputSize();
			reportTyping();
		};

		const getInputPlaceholder = (channel: ClientChan) => {
			if (channel.type === ChanType.CHANNEL || channel.type === ChanType.QUERY) {
				const to = writeTarget(props.network, channel);

				return to
					? `Write to ${channel.name} · sent in ${languageName(
							to,
							readingLanguage(props.network, channel)
					  )}`
					: t("composer.placeholder", {name: channel.name});
			}

			return "";
		};

		// A conversation (channel or query) on a network that is down: the
		// draft can be typed but not sent — only a slash command goes, so
		// `/connect` and friends still work from here — and a strip above the
		// input says what the network is doing. The lobby is left alone: its
		// input is for commands, and it is where the connection reports.
		const isConversation = computed(
			() => props.channel.type === ChanType.CHANNEL || props.channel.type === ChanType.QUERY
		);

		const showConnectionBar = computed(
			() => isConversation.value && !props.network.status.connected
		);

		const canSend = computed(
			() =>
				props.network.status.connected ||
				!isConversation.value ||
				props.channel.pendingMessage.startsWith("/")
		);

		// The wait before the transport's next retry (`status.retryAt`) counts
		// down here — a tick every half second while the strip shows — and
		// "Connect now" skips it (`/connect` restarts the schedule).
		const now = ref(Date.now());
		let ticker: ReturnType<typeof setInterval> | null = null;

		const retryInSeconds = computed(() => {
			const at = props.network.status.retryAt;

			if (!props.network.status.connecting || at === undefined) {
				return 0;
			}

			return Math.max(0, Math.ceil((at - now.value) / 1000));
		});

		const connectionLabel = computed(() => {
			const name = props.network.name || t("composer.fallbackNetwork");

			if (!props.network.status.connecting) {
				return t("composer.disconnectedFrom", {network: name});
			}

			return retryInSeconds.value > 0
				? tCount("composer.reconnectIn", retryInSeconds.value, {
						network: name,
						seconds: retryInSeconds.value,
				  })
				: t("composer.connectingTo", {network: name});
		});

		// Idle, or waiting for a retry: a dial in flight offers nothing.
		const canConnectNow = computed(
			() => !props.network.status.connecting || retryInSeconds.value > 0
		);

		watch(
			showConnectionBar,
			(shown) => {
				if (shown && ticker === null) {
					now.value = Date.now();
					ticker = setInterval(() => {
						now.value = Date.now();
					}, 500);
				} else if (!shown && ticker !== null) {
					clearInterval(ticker);
					ticker = null;
				}
			},
			{immediate: true}
		);

		watch(
			() => props.network.status.retryAt,
			() => {
				now.value = Date.now();
			}
		);

		// The same `/connect` the sidebar's status icon sends; any window of
		// the network routes to its client.
		const connectNetwork = () => {
			socket.emit("input", {target: props.channel.id, text: "/connect"});
		};

		// Reply/edit compose bar (channel.replyTo / channel.editing).
		const composeTarget = computed(() => props.channel.editing || props.channel.replyTo);

		const composeNick = computed(() => composeTarget.value?.from?.nick ?? "");

		// "Replying to {nick}:" keeps the nick emphasized across translations:
		// the translated sentence is split around the substituted nick so it
		// can stay inside its <strong> whatever word order the locale picks.
		const replyingParts = computed(() => {
			const nick = composeNick.value;
			const label = t("composer.replyingTo", {nick});
			const at = nick ? label.indexOf(nick) : -1;

			if (at < 0) {
				return {prefix: label, nick: "", suffix: ""};
			}

			return {
				prefix: label.slice(0, at),
				nick,
				suffix: label.slice(at + nick.length),
			};
		});

		const composePreview = computed(() => {
			const text = (composeTarget.value?.text ?? "").replace(/\s+/g, " ").trim();
			return text.length > 80 ? text.slice(0, 79) + "…" : text;
		});

		// The outgoing translation (spec § Composer): the strip above the
		// input is store state per channel (writer.ts), so a channel switch
		// keeps it like it keeps the draft.
		const outgoing = computed(() => store.state.outgoingTranslations[props.channel.id]);

		// The strip's labels name their languages in the language the user
		// reads this channel in, not the browser's (reader.ts readingLanguage).
		const readerName = (code: string) =>
			languageName(code, readingLanguage(props.network, props.channel));

		// Source → target, "→ German" until (or unless) a source is named.
		const outgoingChip = computed(() => {
			const entry = outgoing.value;

			if (!entry) {
				return "";
			}

			return entry.from
				? `${readerName(entry.from)} → ${readerName(entry.to)}`
				: `→ ${readerName(entry.to)}`;
		});

		// The read-back row's label: the translation's language → the one it
		// is read back into, the user's reading language.
		const outgoingCheckLabel = computed(() =>
			outgoing.value
				? `${readerName(outgoing.value.to)} → ${readerName(
						readingLanguage(props.network, props.channel)
				  )}`
				: ""
		);

		// Which route the strip's text came down, in the chip's title: the
		// pair as the request asked for it ("auto" where the source was left
		// to the model), the model's own id, whether it ran on the GPU, and
		// whether the bare second try ran. The chip's visible text stays the
		// draft's direction -- this is for someone wondering why a
		// translation reads as it does. No title until the route has answered.
		const outgoingChipTitle = computed(() => {
			const entry = outgoing.value;

			if (!entry || !entry.model) {
				return undefined;
			}

			const from = entry.requestFrom ? readerName(entry.requestFrom) : "auto";
			const route = `${from} → ${readerName(entry.to)} · ${entry.model} (${
				entry.engine === "llm" ? "GPU" : "CPU"
			})`;

			return entry.retried ? `${route} · retried without a source` : route;
		});

		// The route's model downloading for this draft (service.ts loads it on
		// demand, and the deadline waits for it): the strip says so rather
		// than blink a caret for minutes.
		const outgoingDownload = computed(() => {
			const entry = outgoing.value;

			if (!entry || entry.status !== "pending" || entry.text || !entry.model) {
				return "";
			}

			const view = store.state.translation.models.find((v) => v.ref.id === entry.model);

			return view && view.status === "downloading" ? loadNote(view) : "";
		});

		// Why it failed, beside "couldn't translate": an ORT session error or
		// a model id is long and multi-line, so the strip shows the head of it
		// and the title carries the whole thing.
		const shortReason = (error: string | null) => {
			if (!error) {
				return "";
			}

			const text = error.replace(/\s+/g, " ").trim();

			return text.length > REASON_MAX ? `${text.slice(0, REASON_MAX - 1)}…` : text;
		};

		// Copy: the translation is what the strip is showing, so it is what
		// the button puts on the clipboard. The label says so for two
		// seconds, since nothing else about the page changes.
		const copiedOutgoing = ref(false);
		let copiedTimer: number | null = null;

		const copyOutgoing = () => {
			const entry = outgoing.value;

			if (!entry) {
				return;
			}

			void writeClipboard(entry.text).then((copied) => {
				if (!copied) {
					return;
				}

				copiedOutgoing.value = true;

				if (copiedTimer !== null) {
					window.clearTimeout(copiedTimer);
				}

				copiedTimer = window.setTimeout(() => {
					copiedOutgoing.value = false;
					copiedTimer = null;
				}, COPIED_LABEL_MS);
			});
		};

		// Send waits for the translation, and for the automatic check.
		const outgoingBusy = computed(() => {
			const entry = outgoing.value;

			if (!entry) {
				return false;
			}

			return entry.status === "pending" || entry.check.status === "pending";
		});

		const sendTooltip = computed(() => {
			if (!canSend.value) {
				return t("composer.notConnected");
			}

			if (!outgoing.value) {
				return t("composer.send");
			}

			return outgoing.value.status === "failed" ? "Send as written" : "Send the translation";
		});

		/**
		 * Run `line` as a UI-only command (`/collapse`, `/search`, …).
		 * True when the line is consumed here and must not reach the bus —
		 * also for a bare `/`, which is not a command at all.
		 */
		const runClientCommand = (line: string): boolean => {
			if (line[0] !== "/" || line[1] === "/") {
				return false;
			}

			const args = line.substring(1).split(" ");
			const cmd = args.shift()?.toLowerCase();

			if (!cmd) {
				return true;
			}

			return (
				Object.prototype.hasOwnProperty.call(commands, cmd) && commands[cmd](args) === true
			);
		};

		/**
		 * Ship `text` as the message; `original` is what the input history
		 * remembers (the draft, when `text` is its translation). Everything
		 * a send does lives here so the plain path, the translated path and
		 * the "send as written" path cannot drift apart.
		 */
		const deliver = (text: string, original: string) => {
			const target = props.channel.id;
			const editing = props.channel.editing;
			const replyTo = props.channel.replyTo;

			if (autocompletionRef.value) {
				autocompletionRef.value.hide();
			}

			props.channel.inputHistoryPosition = 0;
			props.channel.pendingMessage = "";
			clearInput();
			setInputSize();

			// No `done` on submit: the `input` emit below makes the IRC layer
			// reset its typing state when it sends the PRIVMSG (the message
			// itself ends typing on the receiver), so only forget the
			// announcement here. Slash commands were already `done` when the
			// leading "/" was typed.
			typing.sent(target);

			// Store new message in history if last message isn't already equal
			if (props.channel.inputHistory[1] !== original) {
				props.channel.inputHistory.splice(1, 0, original);
			}

			// Limit input history to a 100 entries
			if (props.channel.inputHistory.length > 100) {
				props.channel.inputHistory.pop();
			}

			// A user-defined alias replaces the line before anything looks at
			// it, so its expansion reaches the UI-only commands below as well
			// as the IRC layer. Never while editing: the edit body is text.
			if (!editing) {
				const expanded = expandAlias(text, {
					chan: props.channel.name,
					me: props.network.nick,
				});

				if (expanded) {
					for (const line of expanded) {
						if (!runClientCommand(line)) {
							socket.emit("input", {target, text: line});
						}
					}

					props.channel.replyTo = null;
					props.channel.editing = null;
					return;
				}
			}

			if (text[0] === "/" && runClientCommand(text)) {
				return false;
			}

			// An edit keeps the parent of the message it replaces; the IRC layer
			// only honours `reply`/`edit` for plain text (and `reply` for /me).
			const reply = editing ? editing.replyTo : replyTo?.msgid;
			const edit = editing?.msgid;

			socket.emit("input", {
				target,
				text,
				...(reply ? {reply} : {}),
				...(edit ? {edit} : {}),
			});

			props.channel.replyTo = null;
			props.channel.editing = null;
		};

		const onSubmit = (fromEnterKey = false) => {
			if (!input.value) {
				return;
			}

			// Triggering click event opens the virtual keyboard on mobile
			// This can only be called from another interactive event (e.g. button click)
			input.value.click();
			input.value.focus();

			// No global gate: `/connect` and friends must work from a
			// disconnected network. Plain text in a conversation on a
			// network that is down stays as the draft (`canSend`, the same
			// rule that disables the send button); elsewhere the IRC layer
			// answers it with the `send.notConnected` error.

			// A keyboard that inserts the Return's newline before the keypress
			// fires has already put it in the draft.
			let text = props.channel.pendingMessage;

			if (fromEnterKey && text.endsWith("\n")) {
				text = text.slice(0, -1);
				props.channel.pendingMessage = text;
			}

			if (text.length === 0 || !canSend.value) {
				// Return on an empty composer inserts a newline; an offline
				// composer keeps its draft.
				if (text.length === 0 && fromEnterKey) {
					clearInput();
					setInputSize();
				}

				return false;
			}

			const editing = props.channel.editing;

			// Editing to the identical text is a no-op: just leave edit mode.
			if (editing && text === editing.text) {
				cancelCompose(props.channel);
				clearInput();
				setInputSize();
				reportTyping(); // nothing was sent, so this is a real `done`
				return false;
			}

			// The second Enter (spec § Composer 5): the strip's translation
			// goes, or after a failure the draft as written. Nothing goes
			// while it is still translating (or, with the automatic check,
			// still reading back).
			const entry = store.state.outgoingTranslations[props.channel.id];

			if (entry && entry.draft === text) {
				if (outgoingBusy.value) {
					return false;
				}

				const translated = entry.status === "done" ? entry.text : null;
				let line = translated ?? text;

				// A translation that begins with "/" is text, not a command:
				// the IRC layer sends `//x` as the text `/x`, and deliver's
				// own slash intercept would otherwise take it for a UI one.
				if (translated !== null && translated.startsWith("/")) {
					line = `/${translated}`;
				}

				// Before the send: the IRC layer puts the line in the store
				// inside deliver's emit, and cancelOutgoing takes the strip.
				if (translated !== null) {
					recordSentReadBack(props.channel, entry);
				}

				cancelOutgoing(props.channel);
				deliver(line, text);

				if (translated !== null) {
					noteOutgoingSent(
						props.network,
						props.channel,
						text,
						translated,
						entry.to,
						entry.from
					);
				}

				return;
			}

			if (entry) {
				// A strip for another draft (the watch below normally removes it first).
				cancelOutgoing(props.channel);
			}

			// The first Enter (spec § Composer 1-3): translate, and send only
			// when the draft turns out to need none.
			if (writeTarget(props.network, props.channel) && draftGate(text, !!editing) === "ok") {
				// The verdict can be seconds late (a cold engine, a slow
				// device), so it is checked against the composer it started
				// in: another conversation, a changed draft or a network that
				// went down in the meantime all leave the draft where it is.
				const startedFor = props.channel.id;

				void translateOutgoing(props.network, props.channel, text).then((verdict) => {
					if (
						verdict === "plain" &&
						props.channel.id === startedFor &&
						props.channel.pendingMessage === text &&
						canSend.value
					) {
						deliver(text, text);
					}
				});

				return false;
			}

			deliver(text, text);
		};

		/**
		 * Return sends. On a touch device the keypress is not cancelled:
		 * cancelling it leaves iOS's shift key down, so every message after the
		 * first starts lowercase. The newline is let through and taken back out
		 * by setPendingMessage when it arrives.
		 */
		const onEnterKey = (e: KeyboardEvent) => {
			if (!hasVirtualKeyboard()) {
				e.preventDefault();
				onSubmit();
				return;
			}

			enterNewlineDeadline = performance.now() + ENTER_NEWLINE_WINDOW_MS;
			onSubmit(true);
		};

		const onUploadInputChange = () => {
			if (!uploadInput.value || !uploadInput.value.files) {
				return;
			}

			const files = Array.from(uploadInput.value.files);
			upload.triggerUpload(files);
			uploadInput.value.value = ""; // Reset <input> element so you can upload the same file
		};

		const openFileUpload = () => {
			uploadInput.value?.click();
		};

		// The file dialog offers what the uploader takes; the drop and paste
		// paths check the same list in `Uploader.triggerUpload`.
		const uploadAccept = computed(() => {
			const accept = store.state.branding.uploads?.accept;
			return accept?.length ? accept.join(",") : undefined;
		});

		// Labels and tooltips of the composer's buttons.
		const cancelUploadLabel = computed(() => t("composer.cancelUpload"));
		const cancelComposeLabel = computed(() => t("composer.cancel"));
		const cancelComposeTitle = computed(() => t("composer.cancelEscape"));
		const uploadFileLabel = computed(() => t("composer.uploadFile"));
		const sendLabel = computed(() => t("composer.send"));

		// The strip above the input while a file is going up
		// (`store.state.uploadProgress`, written by `upload.ts`).
		const uploadLabel = computed(() => {
			const progress = store.state.uploadProgress;

			if (!progress) {
				return "";
			}

			const parts = [t("composer.uploading", {file: progress.fileName})];

			if (progress.count > 1) {
				parts.push(
					t("composer.uploadIndex", {index: progress.index, count: progress.count})
				);
			}

			if (progress.phase === "preparing") {
				parts.push(t("composer.uploadPreparing"));
			} else if (progress.phase === "waiting") {
				parts.push(t("composer.uploadWaiting"));
			}

			return parts.join(" · ");
		});

		const uploadPercent = computed(() => {
			const progress = store.state.uploadProgress;

			if (!progress || progress.phase === "preparing" || progress.total <= 0) {
				return null;
			}

			return Math.min(100, Math.round((progress.loaded / progress.total) * 100));
		});

		const cancelUpload = () => {
			upload.abort();
		};

		const blurInput = () => {
			input.value?.blur();
		};

		// Opening a conversation puts the caret in the input, at the end of
		// any draft, so typing can start at once — with a keyboard. On a
		// phone or tablet focusing raises the on-screen keyboard and reflows
		// the whole layout, so there the input waits to be tapped.
		const focusForTyping = () => {
			if (hasVirtualKeyboard()) {
				return;
			}

			// After the render that swaps in this channel's draft.
			void nextTick(() => {
				const el = input.value;

				if (!el) {
					return;
				}

				el.focus();
				el.setSelectionRange(el.value.length, el.value.length);
			});
		};

		const cancelOutgoingNow = () => {
			cancelOutgoing(props.channel);
			focusForTyping();
		};

		const onBlur = () => {
			if (autocompletionRef.value) {
				autocompletionRef.value.hide();
			}
		};

		watch(
			() => props.channel.id,
			() => {
				if (autocompletionRef.value) {
					autocompletionRef.value.hide();
				}

				// A draft left in the previous channel is reported `paused` there.
				typing.switchTarget();
				focusForTyping();
			}
		);

		watch(
			() => props.channel.pendingMessage,
			(value) => {
				setInputSize();

				// Typing, or walking the history, invalidates the strip (spec
				// § Composer 3): the next Enter translates afresh.
				const entry = store.state.outgoingTranslations[props.channel.id];

				if (entry && value !== entry.draft) {
					cancelOutgoing(props.channel);
				}
			}
		);

		onMounted(() => {
			eventbus.on("escapekey", blurInput);
			// A click on the sidebar row of the conversation already open
			// (ChannelWrapper.vue): no route change, still "let me type".
			eventbus.on("input:focus", focusForTyping);
			focusForTyping();

			if (store.state.settings.autocomplete) {
				if (!input.value) {
					throw new Error("ChatInput autocomplete: input element is not available");
				}

				autocompletionRef.value = autocompletion(input.value);
			}

			const inputTrap = Mousetrap(input.value);

			inputTrap.bind(Object.keys(formattingHotkeys), function (e, key) {
				const modifier = formattingHotkeys[key];

				if (!e.target) {
					return;
				}

				wrapCursor(
					e.target as HTMLTextAreaElement,
					modifier,
					(e.target as HTMLTextAreaElement).selectionStart ===
						(e.target as HTMLTextAreaElement).selectionEnd
						? ""
						: modifier
				);

				return false;
			});

			inputTrap.bind(Object.keys(bracketWraps), function (e, key) {
				if (
					(e.target as HTMLTextAreaElement)?.selectionStart !==
					(e.target as HTMLTextAreaElement).selectionEnd
				) {
					wrapCursor(e.target as HTMLTextAreaElement, key, bracketWraps[key]);

					return false;
				}
			});

			// Escape cancels a pending reply/edit before anything else gets it
			// (the global handler in App.vue blurs the input otherwise).
			inputTrap.bind("esc", () => {
				// A translation strip goes first (spec § Composer 6); the draft stays.
				if (store.state.outgoingTranslations[props.channel.id]) {
					cancelOutgoing(props.channel);
					return false;
				}

				if (!props.channel.replyTo && !props.channel.editing) {
					return;
				}

				// Escape from an edit hands ArrowUp back to input history
				// until the user types again (`editDismissed`).
				if (props.channel.editing) {
					props.channel.editDismissed = true;
				}

				cancelCompose(props.channel);

				if (input.value) {
					input.value.value = props.channel.pendingMessage;
					setInputSize();
				}

				reportTyping(); // cancelling an edit empties the input → `done`

				return false;
			});

			inputTrap.bind(["up", "down"], (e, key) => {
				if (
					store.state.isAutoCompleting ||
					(e.target as HTMLTextAreaElement).selectionStart !==
						(e.target as HTMLTextAreaElement).selectionEnd ||
					!input.value
				) {
					return;
				}

				// ArrowUp in an EMPTY input edits your newest own message in this
				// channel (the usual chat convention); once editing, further
				// ArrowUp/Down presses step the edit through your own messages
				// (the editing branch below). Input history keeps ArrowUp whenever
				// there is text in the box, when history is already being browsed,
				// or when there is no own editable message here; Escape dismisses
				// the edit (`editDismissed`, cleared by typing), so ArrowUp after
				// it browses history instead of re-entering the edit.
				if (
					key === "up" &&
					props.channel.pendingMessage === "" &&
					props.channel.inputHistoryPosition === 0 &&
					!props.channel.editDismissed &&
					!props.channel.editing
				) {
					const last = findLastEditable(props.channel);

					if (last) {
						startEdit(props.channel, last);
						input.value.value = props.channel.pendingMessage;
						setInputSize();
						return false;
					}
				}

				const onRow = (
					input.value.value.slice(undefined, input.value.selectionStart).match(/\n/g) ||
					[]
				).length;
				const totalRows = (input.value.value.match(/\n/g) || []).length;

				const {channel} = props;

				// While editing, ArrowUp/Down move the edit to your previous/next
				// own editable message instead of browsing input history — but
				// only while the text is untouched, so an edit in progress is
				// never thrown away by an arrow key. ArrowDown past the newest
				// leaves edit mode, back to the empty input ArrowUp started from.
				if (channel.editing) {
					if (channel.pendingMessage !== (channel.editing.text ?? "")) {
						return; // a modified edit: the arrows just move the caret
					}

					if (key === "up" ? onRow !== 0 : onRow !== totalRows) {
						return;
					}

					const next =
						key === "up"
							? findEditableBefore(channel, channel.editing)
							: findEditableAfter(channel, channel.editing);

					if (next) {
						startEdit(channel, next);
					} else if (key === "down") {
						cancelCompose(channel); // past the newest: edit over
						reportTyping(); // ...which empties the input → `done`
					} else {
						return; // already at the oldest own message
					}

					input.value.value = channel.pendingMessage;
					setInputSize();

					return false;
				}

				if (channel.inputHistoryPosition === 0) {
					channel.inputHistory[channel.inputHistoryPosition] = channel.pendingMessage;
				}

				if (key === "up" && onRow === 0) {
					if (channel.inputHistoryPosition < channel.inputHistory.length - 1) {
						channel.inputHistoryPosition++;
					} else {
						return;
					}
				} else if (
					key === "down" &&
					channel.inputHistoryPosition > 0 &&
					onRow === totalRows
				) {
					channel.inputHistoryPosition--;
				} else {
					return;
				}

				channel.pendingMessage = channel.inputHistory[channel.inputHistoryPosition];
				input.value.value = channel.pendingMessage;
				setInputSize();

				return false;
			});

			// Always listen for drops and pastes: without a configured uploader
			// the handler swallows them and shows a one-off notice instead of
			// letting the browser navigate to the dropped file.
			upload.mounted(store);
		});

		onUnmounted(() => {
			if (ticker !== null) {
				clearInterval(ticker);
				ticker = null;
			}

			if (copiedTimer !== null) {
				window.clearTimeout(copiedTimer);
				copiedTimer = null;
			}

			eventbus.off("escapekey", blurInput);
			eventbus.off("input:focus", focusForTyping);

			if (autocompletionRef.value) {
				autocompletionRef.value.destroy();
				autocompletionRef.value = undefined;
			}

			upload.unmounted();
			upload.abort();
			typing.dispose();
		});

		return {
			store,
			t,
			input,
			uploadInput,
			onUploadInputChange,
			openFileUpload,
			uploadAccept,
			uploadLabel,
			uploadPercent,
			cancelUpload,
			cancelUploadLabel,
			cancelComposeLabel,
			cancelComposeTitle,
			uploadFileLabel,
			sendLabel,
			blurInput,
			onBlur,
			setInputSize,
			upload,
			getInputPlaceholder,
			onSubmit,
			onEnterKey,
			setPendingMessage,
			cancelCompose,
			replyingParts,
			composePreview,
			showConnectionBar,
			canSend,
			connectionLabel,
			retryInSeconds,
			canConnectNow,
			connectNetwork,
			outgoing,
			outgoingChip,
			outgoingCheckLabel,
			outgoingChipTitle,
			outgoingDownload,
			shortReason,
			outgoingBusy,
			sendTooltip,
			cancelOutgoingNow,
			copiedOutgoing,
			copyOutgoing,
		};
	},
});
</script>
