<template>
	<span class="content">
		<bdi><Username :user="message.from" /></bdi>
		{{ t("msg.kick") }}
		<bdi><Username :user="message.target" /></bdi>
		<i v-if="message.text" class="part-reason"
			>&#32;(<ParsedMessage :network="network" :message="message" />)</i
		>
	</span>
</template>

<script lang="ts">
import {defineComponent, PropType} from "vue";
import {ClientNetwork, ClientMessage} from "../../js/types";
import ParsedMessage from "../ParsedMessage.vue";
import Username from "../Username.vue";
import {useI18n} from "../../js/i18n";

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

		return {
			t,
		};
	},
});
</script>
