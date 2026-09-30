<template>
	<div v-if="visible" class="typing-indicator" role="status" aria-live="polite">
		<span v-if="summary" class="typing-indicator-text">{{ summary }}</span>
	</div>
</template>

<script lang="ts">
import {computed, defineComponent, PropType} from "vue";
import type {ClientChan} from "../js/types";
import {useI18n} from "../js/i18n";

// A one-line "alice is typing…" strip above the input, with a fixed height
// (see #form .typing-indicator in style.css). It appears with the first
// typing entry — the scrollback moves up once to make room — and once the
// entries are gone the empty line stays (`channel.typingReserved`) so the
// scrollback does not bounce back. The next message appended to the channel
// releases the reservation (socket-events/typing.ts) in the same render, so
// the new message fills the space and the view does not move again.
// Expired entries are dropped by the shared sweep in helpers/typingExpiry.ts,
// so whatever is in `channel.typing` here is live.
export default defineComponent({
	name: "TypingIndicator",
	props: {
		channel: {type: Object as PropType<ClientChan>, required: true},
	},
	setup(props) {
		const {t, tCount} = useI18n();

		const visible = computed(
			() => props.channel.typing.length > 0 || props.channel.typingReserved
		);

		// One key per length up to three (word order is free per locale);
		// beyond that the two longest-typing nicks are named and the rest is
		// summarized as a count, plural for the "{count} others" noun.
		const summary = computed(() => {
			const nicks = props.channel.typing.map((entry) => entry.nick);

			switch (nicks.length) {
				case 0:
					return "";
				case 1:
					return t("typing.one", {nick: nicks[0]});
				case 2:
					return t("typing.two", {nick1: nicks[0], nick2: nicks[1]});
				case 3:
					return t("typing.three", {
						nick1: nicks[0],
						nick2: nicks[1],
						nick3: nicks[2],
					});
				default:
					return tCount("typing.many", nicks.length - 2, {
						nick1: nicks[0],
						nick2: nicks[1],
					});
			}
		});

		return {visible, summary};
	},
});
</script>
