<template>
	<div
		:id="'msg-' + message.id"
		:class="[
			'msg',
			{
				self: message.self,
				highlight: (message.highlight && store.state.settings.highlightMessages) || focused,
				pending: message.pending,
				'previous-source': isPreviousSource,
				'actions-open': actionsOpen,
				translated,
				unchanged,
			},
		]"
		:data-type="message.type"
		:data-command="message.command"
		:data-from="message.from && message.from.nick"
		@touchstart.passive="onTouchStart"
		@touchmove.passive="onTouchMove"
		@touchend="onTouchEnd"
		@touchcancel="onTouchEnd"
		@contextmenu="onContextMenu"
		@click="onClick"
	>
		<span
			aria-hidden="true"
			:aria-label="messageTimeLocale"
			class="time tooltipped tooltipped-e"
			>{{ `${messageTime}&#32;` }}
		</span>
		<template v-if="message.type === 'unhandled'">
			<span class="from">[{{ message.command }}]</span>
			<!-- One interpolation, single-space joined: the content is
			     `white-space: pre-wrap` (server-formatted /map, /stats…), so
			     any decorative space here would render. -->
			<span class="content">{{ message.params.join(" ") }}</span>
		</template>
		<template v-else-if="isAction()">
			<span class="from"><span class="only-copy" aria-hidden="true">***&nbsp;</span></span>
			<component :is="messageComponent" :network="network" :message="message" />
		</template>
		<template v-else-if="message.type === 'action'">
			<span class="from"><span class="only-copy">*&nbsp;</span></span>
			<span class="content" dir="auto">
				<button
					v-if="message.replyTo"
					type="button"
					class="msg-reply-quote"
					:class="{unknown: !quote}"
					:aria-label="quoteLabel"
					:title="quote ? quote.text : undefined"
					@click="jumpToParent"
				>
					<span class="msg-reply-arrow" aria-hidden="true">↩</span>
					<template v-if="quote"
						><span class="msg-reply-nick">{{ quote.nick }}</span
						>&#32;<span class="msg-reply-text">{{ quote.text }}</span></template
					>
					<span v-else class="msg-reply-text">{{ t("message.replyUnknown") }}</span>
				</button>
				<StatusmsgMarker :group="message.statusmsgGroup" />
				<Username
					:user="message.from"
					:network="network"
					:channel="channel"
					dir="auto"
				/>&#32;<button
					v-if="message.redacted && !revealed"
					type="button"
					class="msg-redacted"
					:aria-label="redactedRevealLabel"
					@click="revealed = true"
				>
					{{ redactedLabel }}</button
				><span
					v-else-if="message.redacted"
					class="msg-redacted-revealed"
					:title="redactedHideTitle"
					@click="hideRevealed"
					><ParsedMessage :message="message" />
					<span class="msg-redacted-note">{{ redactedLabel }}</span></span
				><ParsedMessage v-else :message="message" />
				<span v-if="message.editOf" class="msg-edited" :title="editedTitle">{{
					t("message.editedBadge")
				}}</span>
				<TranslationLine
					v-if="channel && (!message.redacted || revealed)"
					:message="message"
					:channel="channel"
					:network="network"
				/>
				<!-- A deleted message hides its previews with its text: the
				placeholder would otherwise sit above the very image it deleted.
				Revealing the text brings them back. -->
				<template v-if="!message.redacted || revealed">
					<LinkPreview
						v-for="preview in message.previews"
						:key="preview.link"
						:keep-scroll-position="keepScrollPosition"
						:link="preview"
						:channel="channel"
					/>
				</template>
				<MessageReactions :message="message" :channel="channel" :network="network" />
			</span>
		</template>
		<template v-else>
			<span v-if="message.type === 'message'" class="from">
				<template v-if="message.from && message.from.nick">
					<span class="only-copy" aria-hidden="true">&lt;</span>
					<Username :user="message.from" :network="network" :channel="channel" />
					<span class="only-copy" aria-hidden="true">&gt;&nbsp;</span>
				</template>
			</span>
			<span v-else-if="message.type === 'plugin'" class="from">
				<template v-if="message.from && message.from.nick">
					<span class="only-copy" aria-hidden="true">[</span>
					{{ message.from.nick }}
					<span class="only-copy" aria-hidden="true">]&nbsp;</span>
				</template>
			</span>
			<span v-else class="from">
				<template v-if="message.from && message.from.nick">
					<span class="only-copy" aria-hidden="true">-</span>
					<Username :user="message.from" :network="network" :channel="channel" />
					<span class="only-copy" aria-hidden="true">-&nbsp;</span>
				</template>
			</span>
			<span class="content" dir="auto">
				<span
					v-if="message.showInActive"
					:aria-label="shownInActiveLabel"
					class="msg-shown-in-active tooltipped tooltipped-e"
					><span></span
				></span>
				<button
					v-if="message.replyTo"
					type="button"
					class="msg-reply-quote"
					:class="{unknown: !quote}"
					:aria-label="quoteLabel"
					:title="quote ? quote.text : undefined"
					@click="jumpToParent"
				>
					<span class="msg-reply-arrow" aria-hidden="true">↩</span>
					<template v-if="quote"
						><span class="msg-reply-nick">{{ quote.nick }}</span
						>&#32;<span class="msg-reply-text">{{ quote.text }}</span></template
					>
					<span v-else class="msg-reply-text">{{ t("message.replyUnknown") }}</span>
				</button>
				<StatusmsgMarker :group="message.statusmsgGroup" />
				<button
					v-if="message.redacted && !revealed"
					type="button"
					class="msg-redacted"
					:aria-label="redactedRevealLabel"
					@click="revealed = true"
				>
					{{ redactedLabel }}</button
				><span
					v-else-if="message.redacted"
					class="msg-redacted-revealed"
					:title="redactedHideTitle"
					@click="hideRevealed"
					><ParsedMessage :network="network" :message="message" />
					<span class="msg-redacted-note">{{ redactedLabel }}</span></span
				><ParsedMessage v-else :network="network" :message="message" />
				<span v-if="message.editOf" class="msg-edited" :title="editedTitle">{{
					t("message.editedBadge")
				}}</span>
				<TranslationLine
					v-if="channel && (!message.redacted || revealed)"
					:message="message"
					:channel="channel"
					:network="network"
				/>
				<!-- A deleted message hides its previews with its text: the
				placeholder would otherwise sit above the very image it deleted.
				Revealing the text brings them back. -->
				<template v-if="!message.redacted || revealed">
					<LinkPreview
						v-for="preview in message.previews"
						:key="preview.link"
						:keep-scroll-position="keepScrollPosition"
						:link="preview"
						:channel="channel"
					/>
				</template>
				<MessageReactions :message="message" :channel="channel" :network="network" />
			</span>
		</template>
		<MessageActions
			v-if="canAct && channel"
			:message="message"
			:channel="channel"
			:network="network"
		/>
	</div>
</template>

<script lang="ts">
import {computed, defineComponent, onUnmounted, PropType, ref, watch} from "vue";

import Username from "./Username.vue";
import LinkPreview from "./LinkPreview.vue";
import ParsedMessage from "./ParsedMessage.vue";
import MessageTypes from "./MessageTypes";
import StatusmsgMarker from "./StatusmsgMarker.vue";
import MessageActions from "./MessageActions.vue";
import MessageReactions from "./MessageReactions.vue";
import TranslationLine from "./TranslationLine.vue";
import {UNCHANGED} from "../js/translate/outgoing";
import {replyQuote} from "../js/helpers/messageUpdates";
import {MessageType} from "../../shared/types/msg";

import type {ClientChan, ClientMessage, ClientNetwork} from "../js/types";
import {useStore} from "../js/store";
import {hasVirtualKeyboard} from "../js/helpers/device";
import {formatDateTime, formatTime} from "../js/i18n/dates";
import {useI18n} from "../js/i18n";

MessageTypes.ParsedMessage = ParsedMessage;
MessageTypes.LinkPreview = LinkPreview;
MessageTypes.Username = Username;

/**
 * The id of the one message showing its long-press-opened action toolbar.
 * Shared by every Message so opening one closes the last; ids are unique
 * across networks (js/irc/ids.ts), so no channel scope is needed.
 */
const openActions = ref<number | null>(null);

/** How long a finger has to stay down before the toolbar opens. Android's own
 * long press is 500 ms too, so the gesture feels like the platform's. */
const LONG_PRESS_MS = 500;

/** A finger that travels further than this is scrolling, not pressing. */
const LONG_PRESS_SLOP_PX = 10;

export default defineComponent({
	name: "Message",
	components: {
		...MessageTypes,
		StatusmsgMarker,
		MessageActions,
		MessageReactions,
		TranslationLine,
	},
	props: {
		message: {type: Object as PropType<ClientMessage>, required: true},
		channel: {type: Object as PropType<ClientChan>, required: false},
		network: {type: Object as PropType<ClientNetwork>, required: true},
		keepScrollPosition: Function as PropType<() => void>,
		isPreviousSource: Boolean,
		focused: Boolean,
	},
	setup(props) {
		const store = useStore();
		const {t, locale} = useI18n();

		// On a touch device the toolbar opens on a long press, as it does in
		// every native chat client, and a tap anywhere puts it away. The
		// message text is not selectable there (style.css, the coarse-pointer
		// rule on `.msg`), so the platform's own long press — a text selection
		// — does not race this one; the toolbar's Copy text stands in for it.
		// Pointer devices keep hovering. Presses that start on a link, a
		// button or a nick are theirs: a link long press is its preview, a
		// nick tap is a whois.
		const actionsOpen = computed(() => openActions.value === props.message.id);

		let pressTimer: ReturnType<typeof setTimeout> | undefined;
		let pressStart: {x: number; y: number} | null = null;
		let swallowClick = false;

		const cancelPress = () => {
			if (pressTimer !== undefined) {
				clearTimeout(pressTimer);
				pressTimer = undefined;
			}

			pressStart = null;
		};

		const onTouchStart = (e: TouchEvent) => {
			if (!hasVirtualKeyboard() || e.touches.length !== 1) {
				return;
			}

			// A new gesture: a long press whose click never came (Android fires
			// contextmenu instead) must not eat this one's.
			swallowClick = false;

			const target = e.target as HTMLElement | null;

			if (target?.closest("a, button, [role='button'], .msg-actions, .reaction-picker")) {
				return;
			}

			const touch = e.touches[0];
			pressStart = {x: touch.clientX, y: touch.clientY};
			pressTimer = setTimeout(() => {
				pressTimer = undefined;
				pressStart = null;
				swallowClick = true;
				openActions.value = props.message.id;

				// A nudge says the press was taken; nothing where the API is missing (iOS).
				if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
					navigator.vibrate(15);
				}
			}, LONG_PRESS_MS);
		};

		const onTouchMove = (e: TouchEvent) => {
			if (!pressStart) {
				return;
			}

			const touch = e.touches[0];

			if (
				Math.abs(touch.clientX - pressStart.x) > LONG_PRESS_SLOP_PX ||
				Math.abs(touch.clientY - pressStart.y) > LONG_PRESS_SLOP_PX
			) {
				cancelPress();
			}
		};

		const onTouchEnd = () => cancelPress();

		// The browser's own long-press menu (Android) would open over ours.
		const onContextMenu = (e: MouseEvent) => {
			if (hasVirtualKeyboard()) {
				e.preventDefault();
			}
		};

		// A tap on the row while a toolbar is open (this row's or another's)
		// closes it; the tap that ends the long press itself is not that tap.
		const onClick = (e: MouseEvent) => {
			if (!hasVirtualKeyboard()) {
				return;
			}

			if (swallowClick) {
				swallowClick = false;
				e.preventDefault();
				e.stopPropagation();
				return;
			}

			if ((e.target as HTMLElement | null)?.closest(".msg-actions, .reaction-picker")) {
				return;
			}

			if (openActions.value !== null) {
				openActions.value = null;
			}
		};

		// A tap outside the scrollback (the header, the input) closes it too.
		const closeFromOutside = (e: Event) => {
			const target = e.target as HTMLElement | null;

			if (!target?.closest(".msg.actions-open, .reaction-picker")) {
				openActions.value = null;
			}
		};

		watch(actionsOpen, (open) => {
			if (open) {
				document.addEventListener("click", closeFromOutside, true);
			} else {
				document.removeEventListener("click", closeFromOutside, true);
			}
		});

		onUnmounted(() => {
			cancelPress();
			document.removeEventListener("click", closeFromOutside, true);

			if (actionsOpen.value) {
				openActions.value = null;
			}
		});

		// The clock and the tooltip both follow the use12hClock setting; the
		// tooltip always spells the seconds (the cell shows only what fits
		// its fixed column) and adds the date. locale.value is read so a
		// language change re-renders what Intl rendered.
		const messageTime = computed(() => {
			void locale.value;
			return formatTime(
				props.message.time.getTime(),
				store.state.settings.showSeconds,
				store.state.settings.use12hClock
			);
		});

		const messageTimeLocale = computed(() => {
			void locale.value;
			return formatDateTime(props.message.time, store.state.settings.use12hClock);
		});

		// An edit keeps its original's time (msg:edit); when it was made is editedAt.
		const editedTitle = computed(() => {
			return props.message.editedAt
				? t("message.editedAt", {
						time: formatDateTime(
							props.message.editedAt,
							store.state.settings.use12hClock
						),
				  })
				: t("message.edited");
		});

		const messageComponent = computed(() => {
			return "message-" + (props.message.type || "invalid"); // TODO: force existence of type in sharedmsg
		});

		// A finished, shown translation is the bright line; the original dims
		// (docs/resources/translation.md § Reading a channel). Pending,
		// failed, dropped or hidden ("Show original only") keep the original
		// at its normal colour.
		const translated = computed(() => {
			const entry = store.state.translations[props.message.id];

			return !!entry && entry.status === "done" && !entry.hidden;
		});

		// A line the engine handed back as it was (the `unchanged` verdict,
		// shown as the "=" chip) has no translation row to be the bright
		// line, so the original is it: it takes the translated ink, which
		// matters for an own line, dimmed by `.self` like every other.
		const unchanged = computed(() => {
			const entry = store.state.translations[props.message.id];

			return (
				!!entry && entry.status === "failed" && entry.error === UNCHANGED && !entry.hidden
			);
		});

		const isAction = () => {
			if (!props.message.type) {
				return false;
			}

			return typeof MessageTypes["message-" + props.message.type] !== "undefined";
		};

		// --- replies, reactions, deletion, edits (bus-contract §1.4) ---

		// Parent of a reply, resolved from the loaded messages by msgid.
		const quote = computed(() => {
			if (!props.message.replyTo || !props.channel) {
				return undefined;
			}

			return replyQuote(props.channel.messages, props.message.replyTo);
		});

		const quoteLabel = computed(() =>
			quote.value
				? t("message.replyingTo", {nick: quote.value.nick, text: quote.value.text})
				: t("message.replyMissing")
		);

		const jumpToParent = () => {
			if (!quote.value) {
				return;
			}

			const el = document.getElementById("msg-" + quote.value.id);

			if (!el) {
				return;
			}

			el.scrollIntoView({block: "center", inline: "nearest"});

			if (typeof el.animate === "function") {
				el.animate(
					[
						{backgroundColor: "var(--highlight-bg-color)"},
						{backgroundColor: "transparent"},
					],
					{duration: 1500, easing: "ease-out"}
				);
			}
		};

		// Deleted messages keep their text; the placeholder toggles it.
		const revealed = ref(false);

		const redactedLabel = computed(() => {
			const r = props.message.redacted;

			if (!r) {
				return "";
			}

			return r.reason
				? t("message.deletedWithReason", {nick: r.by, reason: r.reason})
				: t("message.deleted", {nick: r.by});
		});

		// Labels of the deletion placeholder and its reveal state.
		const redactedRevealLabel = computed(() => t("message.redactedReveal"));
		const redactedHideTitle = computed(() => t("message.redactedHide"));
		const shownInActiveLabel = computed(() => t("message.shownInActive"));

		const hideRevealed = (e: MouseEvent) => {
			// Let links inside the revealed text keep working.
			if ((e.target as HTMLElement | null)?.closest("a")) {
				return;
			}

			revealed.value = false;
		};

		// Hover action bar: only for real chat lines we can address by msgid,
		// and only while the network is connected.
		const canAct = computed(
			() =>
				(props.message.type === MessageType.MESSAGE ||
					props.message.type === MessageType.ACTION) &&
				!!props.message.msgid &&
				!props.message.redacted &&
				props.network.status.connected
		);

		return {
			store,
			actionsOpen,
			onTouchStart,
			onTouchMove,
			onTouchEnd,
			onContextMenu,
			onClick,
			messageTime,
			messageTimeLocale,
			editedTitle,
			messageComponent,
			isAction,
			quote,
			quoteLabel,
			jumpToParent,
			t,
			revealed,
			redactedLabel,
			redactedRevealLabel,
			redactedHideTitle,
			shownInActiveLabel,
			hideRevealed,
			canAct,
			translated,
			unchanged,
		};
	},
});
</script>
