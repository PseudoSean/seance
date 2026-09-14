<template>
	<span class="content">
		{{ parts[0] }}<bdi><Username :user="message.from" /></bdi>{{ parts[1]
		}}<abbr :title="ctcpTitle">CTCP</abbr>{{ parts[2]
		}}<span class="ctcp-message"><ParsedMessage :text="message.ctcpMessage" /></span
		>{{ parts[3] }}
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
		const parts = computed(() =>
			frameSegments(t("system.ctcpRequest"), ["nick", "ctcp", "message"])
		);
		const ctcpTitle = computed(() => t("msg.ctcpTitle"));

		return {
			parts,
			t,
			ctcpTitle,
		};
	},
});
</script>
