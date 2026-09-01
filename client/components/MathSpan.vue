<script lang="ts">
import {defineComponent, h, ref, watch} from "vue";
import {renderMath} from "../js/helpers/ircmessageparser/math";

// One TeX span, rendered by KaTeX once its chunk lands. Until then — and
// forever, offline, the way a code block stays plain without the highlighter —
// the raw TeX shows as text. An edit replaces the text under the same
// component instance, so this is a watch and not `onMounted`: the render of
// the TeX before it must not stay on screen.
export default defineComponent({
	name: "MathSpan",
	props: {
		tex: {type: String, required: true},
		display: {type: Boolean, default: false},
	},
	setup(props) {
		const html = ref<string | undefined>(undefined);
		let generation = 0;

		watch(
			[() => props.tex, () => props.display],
			() => {
				generation += 1;
				html.value = undefined;

				const mine = generation;

				void renderMath(props.tex, props.display).then((rendered) => {
					if (mine === generation) {
						html.value = rendered;
					}
				});
			},
			{immediate: true}
		);

		return () =>
			h(
				props.display ? "div" : "span",
				{class: props.display ? ["md-math-block"] : ["md-math"]},
				html.value === undefined
					? [props.tex]
					: // KaTeX's own markup: it escapes everything it is given
					  [h("span", {class: ["md-math-html"], innerHTML: html.value})]
			);
	},
});
</script>
