<template>
	<span
		class="msg-actions"
		:class="{active: pickerOpen}"
		role="toolbar"
		aria-label="Message actions"
	>
		<button
			type="button"
			class="msg-action msg-action-reply"
			aria-label="Reply"
			title="Reply"
			@click="reply"
		>
			↩
		</button>
		<button
			ref="reactButton"
			type="button"
			class="msg-action msg-action-react"
			aria-label="React"
			title="React"
			:aria-expanded="pickerOpen"
			@mouseenter="preloadEmoji"
			@mousedown.stop
			@click="pickerOpen = !pickerOpen"
		>
			😀
		</button>
		<button
			v-if="codeBlocks.length > 0"
			type="button"
			class="msg-action msg-action-copy"
			:aria-label="copied ? 'Copied' : 'Copy code'"
			:title="copied ? 'Copied' : 'Copy code'"
			@click.stop="copyCode"
		>
			{{ copied ? "✓" : "⧉" }}
		</button>
		<button
			v-if="canEdit"
			type="button"
			class="msg-action msg-action-edit"
			aria-label="Edit"
			title="Edit"
			@click="edit"
		>
			✎
		</button>
		<button
			v-if="canDelete"
			type="button"
			class="msg-action msg-action-delete"
			aria-label="Delete"
			title="Delete"
			@click="remove"
		>
			✕
		</button>
		<ReactionPicker
			v-if="pickerOpen"
			:anchor="reactButton"
			:selected="mine"
			@pick="react"
			@close="pickerOpen = false"
		/>
	</span>
</template>

<script lang="ts">
import {computed, defineComponent, onUnmounted, PropType, ref, watch} from "vue";
import eventbus from "../js/eventbus";
import socket from "../js/socket";
import {writeClipboard} from "../js/clipboard";
import {codeBlocksOf, layout} from "../js/helpers/ircmessageparser/layout";
import {useStore} from "../js/store";
import {startEdit, startReply} from "../js/helpers/compose";
import {myReactions} from "../js/helpers/messageUpdates";
import {loadEmojiCatalog} from "../js/helpers/emoji";
import {ChanType} from "../../shared/types/chan";
import {MessageType} from "../../shared/types/msg";
import type {ClientChan, ClientMessage, ClientNetwork} from "../js/types";
import ReactionPicker from "./ReactionPicker.vue";

// How long the button says so after a copy that worked
const COPIED_MS = 1500;

export default defineComponent({
	name: "MessageActions",
	components: {ReactionPicker},
	props: {
		message: {type: Object as PropType<ClientMessage>, required: true},
		channel: {type: Object as PropType<ClientChan>, required: true},
		network: {type: Object as PropType<ClientNetwork>, required: true},
	},
	setup(props) {
		const store = useStore();
		const pickerOpen = ref(false);
		const reactButton = ref<HTMLButtonElement | null>(null);

		// What we have already reacted with: the picker ticks these, and
		// picking one again takes it back off (bus-contract §1.4 `remove`).
		const mine = computed(() => myReactions(props.message, props.network.nick || ""));

		// The code blocks the message renders, in order, each as its own
		// characters — the fence and the gutter are presentation, so neither is
		// in here. Markdown off means there are no blocks at all, and the cheap
		// test comes first because this runs for every message the toolbar is
		// on: without a fence there is nothing to find.
		const codeBlocks = computed(() => {
			const text = props.message.text ?? "";

			// Optional: mounted without a store (the browser specs in
			// test/client do that), no store means no Markdown
			if (!store?.state.settings.markdown || !text.includes("```")) {
				return [];
			}

			return codeBlocksOf(layout(text, {markdown: true}));
		});

		const copied = ref(false);
		let copiedTimer: ReturnType<typeof setTimeout> | undefined;

		const clearCopied = () => {
			copied.value = false;

			if (copiedTimer !== undefined) {
				clearTimeout(copiedTimer);
				copiedTimer = undefined;
			}
		};

		onUnmounted(clearCopied);

		// Several blocks are one copy, a blank line apart: they were blocks of
		// their own, and a copy that ran them together would be a different
		// program. A copy that did not happen says nothing and changes nothing.
		const copyCode = async () => {
			if (!(await writeClipboard(codeBlocks.value.join("\n\n")))) {
				return;
			}

			clearCopied();
			copied.value = true;
			copiedTimer = setTimeout(clearCopied, COPIED_MS);
		};

		// Only plain text can be edited (the IRC layer resends it tagged).
		const canEdit = computed(
			() => !!props.message.self && props.message.type === MessageType.MESSAGE
		);

		// Own messages anywhere; others' only in channels, where the server
		// decides (chanop / REDACT_WINDOW) and answers FAIL otherwise.
		const canDelete = computed(
			() => !!props.message.self || props.channel.type === ChanType.CHANNEL
		);

		// Fetch the catalog chunk while the pointer is on its way to the button,
		// so the grid is there the moment the picker opens.
		const preloadEmoji = () => void loadEmojiCatalog().catch(() => undefined);

		const reply = () => startReply(props.channel, props.message);
		const edit = () => startEdit(props.channel, props.message);

		const react = (text: string) => {
			if (!props.message.msgid) {
				return;
			}

			socket.emit("msg:react", {
				target: props.channel.id,
				msgid: props.message.msgid,
				text,
				remove: mine.value.includes(text),
			});
		};

		const remove = () => {
			const msgid = props.message.msgid;

			if (!msgid) {
				return;
			}

			const preview = (props.message.text ?? "").slice(0, 120);
			const who = props.message.self
				? "your message"
				: `${props.message.from?.nick}'s message`;

			eventbus.emit(
				"confirm-dialog",
				{
					title: "Delete message",
					text: `Delete ${who}? "${preview}"`,
					button: "Delete",
				},
				(confirmed: boolean) => {
					if (confirmed) {
						socket.emit("msg:redact", {target: props.channel.id, msgid});
					}
				}
			);
		};

		// Close the picker if the message goes away or the channel changes.
		watch(
			() => props.channel.id,
			() => {
				pickerOpen.value = false;
			}
		);

		return {
			pickerOpen,
			reactButton,
			mine,
			canEdit,
			canDelete,
			codeBlocks,
			copied,
			reply,
			edit,
			react,
			preloadEmoji,
			remove,
			copyCode,
		};
	},
});
</script>
