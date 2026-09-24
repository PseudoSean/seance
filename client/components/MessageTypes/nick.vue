<template>
	<span class="content">
		{{ parts[0] }}<bdi><Username :user="message.from" /></bdi>{{ parts[1]
		}}<bdi> <Username :user="{nick: message.new_nick, mode: message.from.mode}" /> </bdi
		>{{ parts[2] }}
	</span>
</template>

<script lang="ts">
import {computed, defineComponent, PropType} from "vue";
import {ClientNetwork, ClientMessage} from "../../js/types";
import Username from "../Username.vue";
import {useI18n} from "../../js/i18n";
import {frameSegments, KEEP} from "../../js/i18n/core";

export default defineComponent({
	name: "MessageTypeNick",
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
	setup() {
		const {t} = useI18n();
		const parts = computed(() =>
			frameSegments(t("system.nick", {nick: KEEP, newNick: KEEP}), ["nick", "newNick"])
		);

		return {
			parts,
			t,
		};
	},
});
</script>
