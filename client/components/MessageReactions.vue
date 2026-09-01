<template>
	<span v-if="badges.length" class="msg-reactions" role="group" aria-label="Reactions">
		<button
			v-for="badge in badges"
			:key="badge.text"
			type="button"
			class="msg-reaction"
			:class="{self: badge.self, word: !badge.emoji}"
			:disabled="!canToggle"
			:aria-pressed="badge.self"
			:aria-label="badge.label"
			:title="badge.title"
			@click="toggle(badge)"
		>
			<span class="msg-reaction-text">{{ badge.text }}</span
			><span v-if="badge.nicks.length > 1" class="msg-reaction-count">{{
				badge.nicks.length
			}}</span>
		</button>
		<button
			v-if="canToggle"
			ref="addButton"
			type="button"
			class="msg-reaction msg-reaction-add"
			aria-label="Add a reaction"
			title="Add a reaction"
			:aria-expanded="pickerOpen"
			@mousedown.stop
			@click="pickerOpen = !pickerOpen"
		>
			<span aria-hidden="true">+</span>
		</button>
		<ReactionPicker
			v-if="pickerOpen"
			:anchor="addButton"
			:selected="mine"
			@pick="pick"
			@close="pickerOpen = false"
		/>
	</span>
</template>

<script lang="ts">
import {computed, defineComponent, PropType, ref, watch} from "vue";
import socket from "../js/socket";
import {isEmojiOnly} from "../js/helpers/emoji";
import {myReactions} from "../js/helpers/messageUpdates";
import {rememberReaction} from "../js/helpers/reactionRecents";
import type {ClientChan, ClientMessage, ClientNetwork} from "../js/types";
import ReactionPicker from "./ReactionPicker.vue";

type Badge = {
	text: string;
	nicks: string[];
	self: boolean;
	label: string;
	title: string;
	/** Emoji get the roomier badge; a word reaction is set as text. */
	emoji: boolean;
};

export default defineComponent({
	name: "MessageReactions",
	components: {ReactionPicker},
	props: {
		message: {type: Object as PropType<ClientMessage>, required: true},
		channel: {type: Object as PropType<ClientChan>, required: false},
		network: {type: Object as PropType<ClientNetwork>, required: true},
	},
	setup(props) {
		const pickerOpen = ref(false);
		const addButton = ref<HTMLButtonElement | null>(null);

		const badges = computed<Badge[]>(() => {
			const me = (props.network.nick || "").toLowerCase();

			return (props.message.reactions ?? []).map((r) => {
				const self = r.nicks.some((n) => n.toLowerCase() === me);
				const who = r.nicks.join(", ");
				const emoji = isEmojiOnly(r.text);

				return {
					text: r.text,
					nicks: r.nicks,
					self,
					emoji,
					label: `${r.text} by ${who}${self ? " (click to remove yours)" : ""}`,
					// A long word reaction is cut off by the badge, so the
					// tooltip carries it in full next to who sent it.
					title: emoji ? who : `${r.text} — ${who}`,
				};
			});
		});

		const canToggle = computed(
			() => !!props.channel && !!props.message.msgid && props.network.status.connected
		);

		const mine = computed(() => myReactions(props.message, props.network.nick || ""));

		const send = (text: string, remove: boolean) => {
			if (!canToggle.value || !props.channel || !props.message.msgid) {
				return;
			}

			if (!remove) {
				rememberReaction(text);
			}

			socket.emit("msg:react", {
				target: props.channel.id,
				msgid: props.message.msgid,
				text,
				remove,
			});
		};

		const toggle = (badge: Badge) => send(badge.text, badge.self);
		const pick = (text: string) => send(text, mine.value.includes(text));

		// Close the picker if the message moves out from under it.
		watch(
			() => props.channel?.id,
			() => {
				pickerOpen.value = false;
			}
		);

		return {badges, canToggle, mine, pickerOpen, addButton, toggle, pick};
	},
});
</script>
