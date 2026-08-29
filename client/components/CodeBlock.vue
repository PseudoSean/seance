<script lang="ts">
import {computed, defineComponent, h, ref, VNode, watch} from "vue";
import {MIN_GUESS_LINES, splitLines} from "../js/helpers/ircmessageparser/codeLines";
import type {Highlighted} from "../js/helpers/ircmessageparser/highlighter";

// One row per line, so the gutter can count them in CSS and a copy of the
// block yields only the code. Highlighting arrives late or not at all: the
// highlighter, the grammar and the language guesser are all webpack chunks, and
// an installed app offline has none of them (the service worker precaches the
// shell, not these). Until then — and forever, for a language nobody named and
// nothing recognised — the block is plain monospace text.
export default defineComponent({
	name: "CodeBlock",
	props: {
		code: {type: String, required: true},
		lang: {type: String, default: undefined},
	},
	setup(props) {
		// The Prism id in force, once something has resolved one
		const id = ref<string | undefined>(undefined);
		const tokens = ref<Highlighted | undefined>(undefined);
		const plain = computed(() => splitLines(props.code));
		const lines = computed<Highlighted>(
			() => tokens.value ?? plain.value.map((text) => (text ? [{text}] : []))
		);

		// An edit replaces the text under the same component instance, so this
		// is a watch and not `onMounted`: the tokens of the text before it must
		// not stay on screen. `resolve` awaits chunk fetches, so a run that
		// started for text that is gone drops what it found.
		let generation = 0;

		watch(
			[() => props.code, () => props.lang],
			() => {
				generation += 1;
				tokens.value = undefined;
				id.value = undefined;

				// A tagless one-liner is never guessed: nothing to fetch
				if (props.lang || plain.value.length >= MIN_GUESS_LINES) {
					void resolve(generation);
				}
			},
			{immediate: true}
		);

		async function resolve(mine: number) {
			const code = props.code;
			let highlighter;

			try {
				highlighter = await import(
					/* webpackChunkName: "highlighter" */ "../js/helpers/ircmessageparser/highlighter"
				);
			} catch {
				// Offline, or the chunk is gone: the block stays plain
				return;
			}

			// A tag is taken at its word; only an untagged block is guessed
			const lang = props.lang
				? highlighter.normalizeLang(props.lang)
				: await highlighter.guessLanguage(code);

			if (!lang || mine !== generation) {
				return;
			}

			id.value = lang;

			if ((await highlighter.ensureLanguage(lang)) && mine === generation) {
				tokens.value = highlighter.highlight(code, lang);
			}
		}

		return () =>
			h(
				"code",
				{
					class: [
						"md-code-block",
						plain.value.length >= 2 ? "md-code-block--numbered" : undefined,
					],
					"data-lang": id.value,
				},
				lines.value.map((line) =>
					h(
						"span",
						{class: ["md-line"]},
						line.map((token): VNode | string =>
							token.type
								? h("span", {class: ["tok-" + token.type]}, token.text)
								: token.text
						)
					)
				)
			);
	},
});
</script>
