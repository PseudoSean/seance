<template>
	<span class="content">
		<ParsedMessage v-if="message.self" :network="network" :message="message" />
		<template v-else>
			<bdi><Username :user="message.from" /></bdi>
			{{ t("msg.back") }}
		</template>
	</span>
</template>

<script lang="ts">
import {defineComponent, PropType} from "vue";
import {ClientNetwork, ClientMessage} from "../../js/types";
import ParsedMessage from "../ParsedMessage.vue";
import Username from "../Username.vue";
import {useI18n} from "../../js/i18n";

export default defineComponent({
	name: "MessageTypeBack",
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
