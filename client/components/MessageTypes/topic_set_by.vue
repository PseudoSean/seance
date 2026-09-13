<template>
	<span class="content">
		{{ t("msg.topicSetBy") }}
		<bdi><Username :user="message.from" /></bdi>
		{{ t("msg.topicSetOn", {time: messageTimeLocale}) }}
	</span>
</template>

<script lang="ts">
import localetime from "../../js/helpers/localetime";
import {computed, defineComponent, PropType} from "vue";
import {ClientNetwork, ClientMessage} from "../../js/types";
import Username from "../Username.vue";
import {useI18n} from "../../js/i18n";

export default defineComponent({
	name: "MessageTypeTopicSetBy",
	components: {
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
		const messageTimeLocale = computed(() => localetime(props.message.when));

		return {
			t,
			messageTimeLocale,
		};
	},
});
</script>
