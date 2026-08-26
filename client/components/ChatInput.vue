<template>
	<form id="form" method="post" action="" @submit.prevent="onSubmit">
		<span id="upload-progressbar" />
		<TypingIndicator :channel="channel" />
		<div v-if="channel.editing || channel.replyTo" class="compose-bar" role="status">
			<span v-if="channel.editing" class="compose-bar-label">
				<span class="compose-bar-icon" aria-hidden="true">✎</span>
				Editing message
				<span class="compose-bar-preview">{{ composePreview }}</span>
			</span>
			<span v-else class="compose-bar-label">
				<span class="compose-bar-icon" aria-hidden="true">↩</span>
				Replying to <strong class="compose-bar-nick">{{ composeNick }}</strong
				>:
				<span class="compose-bar-preview">{{ composePreview }}</span>
			</span>
			<button
				type="button"
				class="compose-bar-cancel"
				aria-label="Cancel"
				title="Cancel (Escape)"
				@click="cancelCompose(channel)"
			>
				✕
			</button>
		</div>
		<span id="nick">{{ network.nick }}</span>
		<label for="input" class="sr-only">Message input</label>
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
			@keypress.enter.exact.prevent="onSubmit"
			@blur="onBlur"
		/>
		<span
			v-if="store.state.serverConfiguration?.fileUpload"
			id="upload-tooltip"
			class="tooltipped tooltipped-w tooltipped-no-touch"
			aria-label="Upload file"
			@click="openFileUpload"
		>
			<input
				id="upload-input"
				ref="uploadInput"
				type="file"
				aria-labelledby="upload"
				multiple
				@change="onUploadInputChange"
			/>
			<button
				id="upload"
				type="button"
				aria-label="Upload file"
				:disabled="!store.state.isConnected"
			/>
		</span>
		<span
			id="submit-tooltip"
			class="tooltipped tooltipped-w tooltipped-no-touch"
			data-tooltip="Send message"
		>
			<button
				id="submit"
				type="submit"
				aria-label="Send message"
				:disabled="!store.state.isConnected"
			/>
		</span>
	</form>
</template>

<script lang="ts">
import Mousetrap from "mousetrap";
import {wrapCursor} from "undate";
import autocompletion from "../js/autocompletion";
import {commands} from "../js/commands/index";
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
import {cancelCompose, findLastEditable, startEdit} from "../js/helpers/compose";
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
		const input = ref<HTMLTextAreaElement>();
		const uploadInput = ref<HTMLInputElement>();
		const autocompletionRef = ref<ReturnType<typeof autocompletion>>();

		const setInputSize = () => {
			void nextTick(() => {
				if (!input.value) {
					return;
				}

				const style = window.getComputedStyle(input.value);
				const lineHeight = parseFloat(style.lineHeight) || 1;

				// Start by resetting height before computing as scrollHeight does not
				// decrease when deleting characters
				input.value.style.height = "";

				// Use scrollHeight to calculate how many lines there are in input, and ceil the value
				// because some browsers tend to incorrently round the values when using high density
				// displays or using page zoom feature
				input.value.style.height = `${
					Math.ceil(input.value.scrollHeight / lineHeight) * lineHeight
				}px`;
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
			props.channel.pendingMessage = (e.target as HTMLInputElement).value;
			props.channel.inputHistoryPosition = 0;
			setInputSize();
			reportTyping();
		};

		const getInputPlaceholder = (channel: ClientChan) => {
			if (channel.type === ChanType.CHANNEL || channel.type === ChanType.QUERY) {
				return `Write to ${channel.name}`;
			}

			return "";
		};

		// Reply/edit compose bar (channel.replyTo / channel.editing).
		const composeTarget = computed(() => props.channel.editing || props.channel.replyTo);

		const composeNick = computed(() => composeTarget.value?.from?.nick ?? "");

		const composePreview = computed(() => {
			const text = (composeTarget.value?.text ?? "").replace(/\s+/g, " ").trim();
			return text.length > 80 ? text.slice(0, 79) + "…" : text;
		});

		const onSubmit = () => {
			if (!input.value) {
				return;
			}

			// Triggering click event opens the virtual keyboard on mobile
			// This can only be called from another interactive event (e.g. button click)
			input.value.click();
			input.value.focus();

			if (!store.state.isConnected) {
				return false;
			}

			const target = props.channel.id;
			const text = props.channel.pendingMessage;

			if (text.length === 0) {
				return false;
			}

			const editing = props.channel.editing;
			const replyTo = props.channel.replyTo;

			// Editing to the identical text is a no-op: just leave edit mode.
			if (editing && text === editing.text) {
				cancelCompose(props.channel);
				input.value.value = "";
				setInputSize();
				reportTyping(); // nothing was sent, so this is a real `done`
				return false;
			}

			if (autocompletionRef.value) {
				autocompletionRef.value.hide();
			}

			props.channel.inputHistoryPosition = 0;
			props.channel.pendingMessage = "";
			input.value.value = "";
			setInputSize();

			// No `done` on submit: the `input` emit below makes the IRC layer
			// reset its typing state when it sends the PRIVMSG (the message
			// itself ends typing on the receiver), so only forget the
			// announcement here. Slash commands were already `done` when the
			// leading "/" was typed.
			typing.sent(target);

			// Store new message in history if last message isn't already equal
			if (props.channel.inputHistory[1] !== text) {
				props.channel.inputHistory.splice(1, 0, text);
			}

			// Limit input history to a 100 entries
			if (props.channel.inputHistory.length > 100) {
				props.channel.inputHistory.pop();
			}

			if (text[0] === "/") {
				const args = text.substring(1).split(" ");
				const cmd = args.shift()?.toLowerCase();

				if (!cmd) {
					return false;
				}

				if (Object.prototype.hasOwnProperty.call(commands, cmd) && commands[cmd](args)) {
					return false;
				}
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

		const blurInput = () => {
			input.value?.blur();
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
			}
		);

		watch(
			() => props.channel.pendingMessage,
			() => {
				setInputSize();
			}
		);

		onMounted(() => {
			eventbus.on("escapekey", blurInput);

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
				if (!props.channel.replyTo && !props.channel.editing) {
					return;
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
				// channel (the usual chat convention). Input history keeps ArrowUp
				// whenever there is text in the box, when history is already being
				// browsed, or when there is no own editable message here; Escape
				// leaves edit mode and empties the input, so a second ArrowUp then
				// browses history as before.
				if (
					key === "up" &&
					props.channel.pendingMessage === "" &&
					props.channel.inputHistoryPosition === 0 &&
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
			eventbus.off("escapekey", blurInput);

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
			input,
			uploadInput,
			onUploadInputChange,
			openFileUpload,
			blurInput,
			onBlur,
			setInputSize,
			upload,
			getInputPlaceholder,
			onSubmit,
			setPendingMessage,
			cancelCompose,
			composeNick,
			composePreview,
		};
	},
});
</script>
