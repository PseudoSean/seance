<template>
	<span v-if="badges.length" class="msg-reactions" role="group" aria-label="Reactions">
		<button
			v-for="badge in badges"
			:key="badge.text"
			type="button"
			class="msg-reaction"
			:class="{self: badge.self}"
			:disabled="!canToggle"
			:aria-pressed="badge.self"
			:aria-label="badge.label"
			:title="badge.nicks.join(', ')"
			@click="toggle(badge)"
		>
			<span class="msg-reaction-text">{{ badge.text }}</span
			><span v-if="badge.nicks.length > 1" class="msg-reaction-count">{{
				badge.nicks.length
			}}</span>
		</button>
	</span>
</template>

<script lang="ts">
import {computed, defineComponent, PropType} from "vue";
import socket from "../js/socket";
import type {ClientChan, ClientMessage, ClientNetwork} from "../js/types";

type Badge = {text: string; nicks: string[]; self: boolean; label: string};

export default defineComponent({
	name: "MessageReactions",
	props: {
		message: {type: Object as PropType<ClientMessage>, required: true},
		channel: {type: Object as PropType<ClientChan>, required: false},
		network: {type: Object as PropType<ClientNetwork>, required: true},
	},
	setup(props) {
		const badges = computed<Badge[]>(() => {
			const me = (props.network.nick || "").toLowerCase();

			return (props.message.reactions ?? []).map((r) => {
				const self = r.nicks.some((n) => n.toLowerCase() === me);
				const who = r.nicks.join(", ");

				return {
					text: r.text,
					nicks: r.nicks,
					self,
					label: `${r.text} by ${who}${self ? " (click to remove yours)" : ""}`,
				};
			});
		});

		const canToggle = computed(
			() => !!props.channel && !!props.message.msgid && props.network.status.connected
		);

		const toggle = (badge: Badge) => {
			if (!canToggle.value || !props.channel || !props.message.msgid) {
				return;
			}

			socket.emit("msg:react", {
				target: props.channel.id,
				msgid: props.message.msgid,
				text: badge.text,
				remove: badge.self,
			});
		};

		return {badges, canToggle, toggle};
	},
});
</script>
