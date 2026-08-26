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
			type="button"
			class="msg-action msg-action-react"
			aria-label="React"
			title="React"
			:aria-expanded="pickerOpen"
			@mousedown.stop
			@click="pickerOpen = !pickerOpen"
		>
			😀
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
		<ReactionPicker v-if="pickerOpen" @pick="react" @close="pickerOpen = false" />
	</span>
</template>

<script lang="ts">
import {computed, defineComponent, PropType, ref, watch} from "vue";
import eventbus from "../js/eventbus";
import socket from "../js/socket";
import {startEdit, startReply} from "../js/helpers/compose";
import {ChanType} from "../../shared/types/chan";
import {MessageType} from "../../shared/types/msg";
import type {ClientChan, ClientMessage, ClientNetwork} from "../js/types";
import ReactionPicker from "./ReactionPicker.vue";

export default defineComponent({
	name: "MessageActions",
	components: {ReactionPicker},
	props: {
		message: {type: Object as PropType<ClientMessage>, required: true},
		channel: {type: Object as PropType<ClientChan>, required: true},
		network: {type: Object as PropType<ClientNetwork>, required: true},
	},
	setup(props) {
		const pickerOpen = ref(false);

		// Only plain text can be edited (the IRC layer resends it tagged).
		const canEdit = computed(
			() => !!props.message.self && props.message.type === MessageType.MESSAGE
		);

		// Own messages anywhere; others' only in channels, where the server
		// decides (chanop / REDACT_WINDOW) and answers FAIL otherwise.
		const canDelete = computed(
			() => !!props.message.self || props.channel.type === ChanType.CHANNEL
		);

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

		return {pickerOpen, canEdit, canDelete, reply, edit, react, remove};
	},
});
</script>
