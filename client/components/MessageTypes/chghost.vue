<template>
	<span class="content">
		{{ parts[0] }}<bdi><Username :user="message.from" /></bdi>{{ parts[1]
		}}<span v-if="message.new_ident"
			><b
				><bdi>{{ message.new_ident }}</bdi></b
			></span
		>{{ parts[2]
		}}<span v-if="message.new_host"
			><i class="hostmask"><ParsedMessage :network="network" :text="message.new_host" /></i
			>{{ parts[3] }}</span
		>
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
	setup(props) {
		const {t} = useI18n();
		// One whole sentence per shape: ident only, host only, both, or
		// neither — the translator writes each variant with the values where
		// they belong. The frames carry a trailing segment even when the
		// value's element is absent, so the segments and the v-ifs agree.
		const parts = computed(() => {
			const {new_ident: ident, new_host: host} = props.message;

			if (ident && host) {
				return frameSegments(t("system.chghostBoth"), ["nick", "ident", "host"]);
			}

			if (ident) {
				return frameSegments(t("system.chghostIdent"), ["nick", "ident"]);
			}

			if (host) {
				return frameSegments(t("system.chghostHost"), ["nick", "host"]);
			}

			return frameSegments(t("system.chghost"), ["nick"]);
		});

		return {
			parts,
			t,
		};
	},
});
</script>
