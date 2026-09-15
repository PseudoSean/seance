<template>
	<!-- Teleported to <body>: the scrollback clips its overflow, and the
	     phone's layout is a sheet along the bottom edge of the screen. -->
	<Teleport to="body">
		<div
			ref="root"
			class="source-language-picker"
			:class="{'source-language-picker--sheet': phone, flipped}"
			:style="style"
			role="dialog"
			aria-label="Retranslate from another language"
			@keydown.esc.stop.prevent="$emit('close')"
		>
			<label class="source-language-picker-field">
				<span class="source-language-picker-label">Translate this line from</span>
				<select
					ref="select"
					v-model="choice"
					name="translateFrom"
					class="input source-language-picker-control"
				>
					<option v-for="code in languages" :key="code" :value="code">
						{{ name(code) }}
					</option>
				</select>
			</label>
			<div class="source-language-picker-actions">
				<button
					type="button"
					class="btn btn-sm source-language-picker-cancel"
					@click="$emit('close')"
				>
					Cancel
				</button>
				<button
					type="button"
					class="btn btn-sm source-language-picker-confirm"
					@click="confirm"
				>
					Translate
				</button>
			</div>
		</div>
	</Teleport>
</template>

<script lang="ts">
import {computed, defineComponent, nextTick, onBeforeUnmount, onMounted, PropType, ref} from "vue";
import {hasVirtualKeyboard} from "../js/helpers/device";
import {SUPPORTED_LANGUAGES, languageOptionLabel} from "../js/translate/languages";

/** Gap between the chip and the popover, and the margin it keeps off screen edges. */
const GAP = 6;
const EDGE = 8;
/** The width below which the popover becomes a sheet: the phone layout's breakpoint. */
const NARROW = "(max-width: 479px)";

export default defineComponent({
	name: "SourceLanguagePicker",
	props: {
		/** The chip the popover hangs off; positioning follows it as you scroll. */
		anchor: {type: Object as PropType<HTMLElement | null>, default: null},
		/** The line's current source ("" when the engine detected it). */
		selected: {type: String, default: ""},
		/** The detector's runners-up, for the preselection when there is no source. */
		candidates: {type: Array as PropType<string[]>, default: () => []},
	},
	emits: ["pick", "close"],
	setup(props, {emit}) {
		const root = ref<HTMLDivElement | null>(null);
		const select = ref<HTMLSelectElement | null>(null);
		const name = (code: string) => languageOptionLabel(code);
		// Every language, named in itself and sorted by that name: the reader
		// is looking for the word they would write, not its English name.
		const languages = [...SUPPORTED_LANGUAGES].sort((a, b) => name(a).localeCompare(name(b)));
		const choice = ref(props.selected || props.candidates[0] || languages[0]);

		const narrowQuery =
			typeof window !== "undefined" && typeof window.matchMedia === "function"
				? window.matchMedia(NARROW)
				: null;
		const narrow = ref(narrowQuery ? narrowQuery.matches : false);

		const onNarrow = (event: MediaQueryListEvent) => {
			narrow.value = event.matches;
		};

		// A touch-primary device has no pointer for a popover's small
		// controls, and a window as narrow as the phone's chat layout has no
		// room for one: the same markup becomes the sheet.
		const phone = computed(() => hasVirtualKeyboard() || narrow.value);

		const style = ref<Record<string, string>>({});
		const flipped = ref(false);

		/**
		 * Pin the popover under (or, with no room, over) the chip. It is
		 * `position: fixed` and teleported to the body, so the anchor is
		 * followed by hand: on scroll and on resize. Scrolled past the
		 * message it belongs to, it closes rather than float over an
		 * unrelated part of the conversation (ReactionPicker.vue's rule).
		 */
		const reposition = () => {
			const el = root.value;
			const anchor = props.anchor;

			if (!el || !anchor) {
				return;
			}

			if (phone.value) {
				style.value = {};
				flipped.value = false;
				return;
			}

			const rect = anchor.getBoundingClientRect();
			const vh = window.innerHeight;
			const vw = window.innerWidth;

			if (rect.bottom < 0 || rect.top > vh) {
				emit("close");
				return;
			}

			const height = el.offsetHeight;
			const width = el.offsetWidth;
			const below = vh - rect.bottom - GAP - EDGE;
			const flip = below < height && rect.top - GAP - EDGE > below;
			const left = Math.min(Math.max(rect.left, EDGE), Math.max(EDGE, vw - width - EDGE));

			flipped.value = flip;
			style.value = {
				left: `${Math.round(left)}px`,
				...(flip
					? {bottom: `${Math.round(vh - rect.top + GAP)}px`}
					: {top: `${Math.round(rect.bottom + GAP)}px`}),
			};
		};

		const close = () => emit("close");

		const confirm = () => {
			emit("pick", choice.value);
			close();
		};

		// Mousetrap's "escapekey" never fires for a synthetic KeyboardEvent
		// (it reads the key code), so the listener is our own — the same one
		// TranslationPanel.vue keeps.
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				close();
			}
		};

		// Bubble phase, like the reaction picker's: the opener stops its own
		// mousedown, so its button toggles instead of reopening.
		const onDocumentMouseDown = (event: MouseEvent) => {
			if (root.value && !root.value.contains(event.target as Node)) {
				close();
			}
		};

		onMounted(() => {
			document.addEventListener("keydown", onKey);
			document.addEventListener("mousedown", onDocumentMouseDown);
			window.addEventListener("scroll", reposition, true);
			window.addEventListener("resize", reposition);
			narrowQuery?.addEventListener("change", onNarrow);

			void nextTick(() => {
				reposition();
				select.value?.focus();
			});
		});

		onBeforeUnmount(() => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("mousedown", onDocumentMouseDown);
			window.removeEventListener("scroll", reposition, true);
			window.removeEventListener("resize", reposition);
			narrowQuery?.removeEventListener("change", onNarrow);

			// The caret goes back to the chip it came from.
			if (root.value?.contains(document.activeElement)) {
				props.anchor?.focus();
			}
		});

		return {root, select, choice, languages, name, phone, flipped, style, confirm};
	},
});
</script>
