<template>
	<span class="content">
		{{ t("msg.modeChannelIs") }} <b>{{ message.text }}</b>
	</span>
</template>

<script lang="ts">
import {defineComponent, PropType} from "vue";
import {ClientNetwork, ClientMessage} from "../../js/types";
import {useI18n} from "../../js/i18n";

export default defineComponent({
	name: "MessageChannelMode",
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
