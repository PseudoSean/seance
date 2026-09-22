<script lang="ts">
// One line of a message, styled but inert, for a quote of it: the reply
// quote under a message and the composer's "Replying to" / "Editing" bar.
// `quoteLayout` folds the message's tree to styled text — bold stays bold, a
// code span monospace, a header bold, a spoiler unread — and cuts it at
// `maxLength` visible characters; `createFragment` gives each run the same
// `irc-*` classes the message itself has. Nothing here is a link, a nick or
// a channel: the quote sits inside a button.
import {computed, defineComponent, h} from "vue";
import {quoteLayout} from "../js/helpers/ircmessageparser/layout";
import {createFragment} from "../js/helpers/fragment";
import {useStore} from "../js/store";

export default defineComponent({
	name: "QuotePreview",
	props: {
		text: {type: String, required: true},
		maxLength: {type: Number, default: 80},
	},
	setup(props) {
		const store = useStore();

		const nodes = computed(() =>
			quoteLayout(props.text, props.maxLength, {markdown: store.state.settings.markdown})
		);

		return () => h("span", {class: "quote-preview"}, nodes.value.map(createFragment));
	},
});
</script>
