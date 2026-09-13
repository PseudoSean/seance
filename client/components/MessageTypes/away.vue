<template>
	<span class="content">
		<ParsedMessage v-if="message.self" :network="network" :message="message" />
		<template v-else>
			<bdi><Username :user="message.from" /></bdi>
			{{ t("msg.away") }}
			<i class="away-message">(<ParsedMessage :network="network" :message="message" />)</i>
		</template>
	</span>
</template>

<script lang="ts">
import {defineComponent, PropType} from "vue";
import type {ClientNetwork, ClientMessage} from "../../js/types";
import ParsedMessage from "../ParsedMessage.vue";
import Username from "../Username.vue";
import {useI18n} from "../../js/i18n";

export default defineComponent({
	name: "MessageTypeAway",
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
