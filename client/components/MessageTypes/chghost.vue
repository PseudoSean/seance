<template>
	<span class="content">
		<bdi><Username :user="message.from" /></bdi>
		{{ t("msg.chghost") }}
		<span v-if="message.new_ident"
			>{{ t("msg.chghostUser") }}
			<b
				><bdi>{{ message.new_ident }}</bdi></b
			></span
		>
		<span v-if="message.new_host"
			>{{ t("msg.chghostHost") }}
			<i class="hostmask"><ParsedMessage :network="network" :text="message.new_host" /></i
		></span>
	</span>
</template>

<script lang="ts">
import {defineComponent, PropType} from "vue";
import {ClientNetwork, ClientMessage} from "../../js/types";
import ParsedMessage from "../ParsedMessage.vue";
import Username from "../Username.vue";
import {useI18n} from "../../js/i18n";

export default defineComponent({
	name: "MessageTypeChangeHost",
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
