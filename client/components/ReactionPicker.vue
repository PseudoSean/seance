<template>
	<div
		ref="root"
		class="reaction-picker"
		role="dialog"
		aria-label="Add a reaction"
		@keydown.esc.stop.prevent="$emit('close')"
	>
		<div class="reaction-picker-quick">
			<button
				v-for="emoji in quickReactions"
				:key="emoji"
				type="button"
				class="reaction-picker-emoji"
				:aria-label="`React with ${emoji}`"
				@click="pick(emoji)"
			>
				{{ emoji }}
			</button>
		</div>
		<form class="reaction-picker-custom" @submit.prevent="pick(custom)">
			<input
				ref="customInput"
				v-model="custom"
				type="text"
				maxlength="64"
				placeholder="Other…"
				aria-label="Custom reaction text"
				autocomplete="off"
			/>
			<button type="submit" :disabled="!custom.trim()" aria-label="Send reaction">Add</button>
		</form>
	</div>
</template>

<script lang="ts">
import {defineComponent, onBeforeUnmount, onMounted, ref} from "vue";
import eventbus from "../js/eventbus";

export const quickReactions = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀"];

export default defineComponent({
	name: "ReactionPicker",
	emits: ["pick", "close"],
	setup(props, {emit}) {
		const root = ref<HTMLDivElement | null>(null);
		const customInput = ref<HTMLInputElement | null>(null);
		const custom = ref("");

		const pick = (text: string) => {
			const trimmed = text.trim();

			if (!trimmed) {
				return;
			}

			emit("pick", trimmed);
			emit("close");
		};

		const close = () => emit("close");

		// Bubble-phase so the opener can `@mousedown.stop` and toggle instead.
		const onDocumentMouseDown = (e: MouseEvent) => {
			if (root.value && !root.value.contains(e.target as Node)) {
				close();
			}
		};

		onMounted(() => {
			document.addEventListener("mousedown", onDocumentMouseDown);
			eventbus.on("escapekey", close);
			customInput.value?.focus();
		});

		onBeforeUnmount(() => {
			document.removeEventListener("mousedown", onDocumentMouseDown);
			eventbus.off("escapekey", close);
		});

		return {root, customInput, custom, quickReactions, pick};
	},
});
</script>
