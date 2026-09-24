<template>
	<span class="content">
		{{ parts[0] }}<bdi><Username :user="message.from" /></bdi>{{ parts[1]
		}}<bdi><Username :user="message.target" /></bdi>{{ parts[2] }}
		<i v-if="message.text" class="part-reason"
			>&#32;(<ParsedMessage :network="network" :message="message" />)</i
		>
	</span>
</template>

<script lang="ts">
import {computed, defineComponent, PropType} from "vue";
import {ClientNetwork, ClientMessage} from "../../js/types";
import ParsedMessage from "../ParsedMessage.vue";
import Username from "../Username.vue";
import {useI18n} from "../../js/i18n";
import {frameSegments, KEEP} from "../../js/i18n/core";

export default defineComponent({
	name: "MessageTypeKick",
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
	setup() {
		const {t} = useI18n();
		const parts = computed(() =>
			frameSegments(t("system.kick", {nick: KEEP, target: KEEP}), ["nick", "target"])
		);

		return {
			parts,
			t,
		};
	},
});
</script>
