<template>
	<span class="content">
		<bdi><Username :user="message.from" /></bdi>
		{{ t("msg.ctcpRequest") }}
		<abbr title="Client-to-client protocol">CTCP</abbr>
		{{ t("msg.ctcpRequestTail") }}
		<span class="ctcp-message"><ParsedMessage :text="message.ctcpMessage" /></span>
	</span>
</template>

<script lang="ts">
import {defineComponent, PropType} from "vue";
import {ClientNetwork, ClientMessage} from "../../js/types";
import ParsedMessage from "../ParsedMessage.vue";
import Username from "../Username.vue";
import {useI18n} from "../../js/i18n";

export default defineComponent({
	name: "MessageTypeRequestCTCP",
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
