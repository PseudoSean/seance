<template>
	<span class="content">
		{{ parts[0] }}<bdi><Username :user="message.from" /></bdi>{{ parts[1]
		}}<span v-if="message.invitedYou">{{ parts[2] }}</span
		><bdi v-else><Username :user="message.target" /></bdi>{{ parts[2]
		}}<ParsedMessage :network="network" :text="message.channel" />{{ parts[3] }}
	</span>
</template>

<script lang="ts">
import {computed, defineComponent, PropType} from "vue";
import {ClientNetwork, ClientMessage} from "../../js/types";
import ParsedMessage from "../ParsedMessage.vue";
import Username from "../Username.vue";
import {useI18n} from "../../js/i18n";
import {frameSegments} from "../../js/i18n/core";

export default defineComponent({
	name: "MessageTypeInvite",
	components: {
		ParsedMessage,
		Username,
	},
	props: {
		network: {
			type: Object as PropType<ClientNetwork>,
			required: true,
		},
		message: {
			type: Object as PropType<ClientMessage>,
			required: true,
		},
	},
	setup(props) {
		const {t} = useI18n();
		// Two whole sentences: the invite aimed at the reader or at someone
		// else. The target slot is the reader's name in one and the
		// interactive username element in the other.
		const parts = computed(() =>
			props.message.invitedYou
				? frameSegments(t("system.inviteYou"), ["nick", "channel"])
				: frameSegments(t("system.inviteTarget"), ["nick", "target", "channel"])
		);

		return {
			parts,
			t,
		};
	},
});
</script>
