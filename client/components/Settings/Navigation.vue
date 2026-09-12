<template>
	<aside class="settings-menu">
		<h2>Settings</h2>
		<ul role="navigation" aria-label="Settings tabs">
			<SettingTabItem
				v-if="showNetworks"
				name="Networks"
				class-name="networks"
				to="networks"
			/>
			<SettingTabItem v-if="showGeneral" name="General" class-name="general" to="" />
			<SettingTabItem name="Appearance" class-name="appearance" to="appearance" />
			<SettingTabItem name="Notifications" class-name="notifications" to="notifications" />
			<SettingTabItem name="Aliases" class-name="aliases" to="aliases" />
			<SettingTabItem v-if="!isPublic" name="Account" class-name="account" to="account" />
		</ul>
	</aside>
</template>

<style>
.settings-menu {
	position: fixed;
	/* top: Header + (padding bottom of h2 - border) */
	top: calc(3rem + 5px);
	/* Mid page minus the width of the container and 30 pixels for padding.
	   The static position already sits right of the sidebar, so at the
	   larger UI scales on a narrow window the offset is clamped there
	   instead of sliding under it. */
	margin-left: max(0.5rem, calc(50% - 30rem - 30px));
}

/* On a window too narrow for the menu to sit beside the content, it is a
 * sticky, horizontally scrollable tab strip instead of a stacked list: one
 * row of icon + label tabs pinned to the top of the settings window, the
 * active one underlined in the theme's accent. The list took a whole
 * screen's height ahead of the content at the big font scales; the strip
 * takes one line and stays put while the page scrolls. The rules live twice
 * on purpose: a px media query (which cannot see the root font size) and
 * the rem container query off the settings window (style.css #settings),
 * like the pair this replaced.
 *
 * The calculation is mobile + 2/3 of container width. Fairly arbitrary. */
@media screen and (max-width: calc(768px + 320px)) {
	.settings-menu {
		position: sticky;
		top: 0;
		z-index: 2;
		width: 100%;
		margin: 0;
		background: var(--window-bg-color);
	}

	.settings-menu h2 {
		display: none;
	}

	.settings-menu ul {
		display: flex;
		flex-wrap: nowrap;
		overflow-x: auto;
		scrollbar-width: none;
		margin: 0;
		padding: 0 0.75rem;
		/* An inset hairline rather than a border: the underline of the
		 * active tab paints over it. */
		box-shadow: inset 0 -1px 0 rgb(128 128 128 / 30%);
	}

	.settings-menu ul::-webkit-scrollbar {
		display: none;
	}

	.settings-menu li {
		flex: 0 0 auto;
	}

	.settings-menu li:not(:last-of-type) button {
		margin-bottom: 0;
	}

	.settings-menu button {
		white-space: nowrap;
		padding: 0.6em 0.75em;
		border-bottom: 2px solid transparent;
	}

	.settings-menu button.active {
		border-bottom-color: var(--button-color);
	}
}

/* The same, in rem, off the settings window itself (a size container,
 * style.css #settings): beside a centred 30rem container the menu has its
 * ~12rem only once the window is 56rem wide, and at the big scales that is
 * wider than most screens, so it becomes the tab strip instead of lying
 * across the content. */
@container settings (max-width: 56rem) {
	.settings-menu {
		position: sticky;
		top: 0;
		z-index: 2;
		width: 100%;
		margin: 0;
		background: var(--window-bg-color);
	}

	.settings-menu h2 {
		display: none;
	}

	.settings-menu ul {
		display: flex;
		flex-wrap: nowrap;
		overflow-x: auto;
		scrollbar-width: none;
		margin: 0;
		padding: 0 0.75rem;
		box-shadow: inset 0 -1px 0 rgb(128 128 128 / 30%);
	}

	.settings-menu ul::-webkit-scrollbar {
		display: none;
	}

	.settings-menu li {
		flex: 0 0 auto;
	}

	.settings-menu li:not(:last-of-type) button {
		margin-bottom: 0;
	}

	.settings-menu button {
		white-space: nowrap;
		padding: 0.6em 0.75em;
		border-bottom: 2px solid transparent;
	}

	.settings-menu button.active {
		border-bottom-color: var(--button-color);
	}
}

.settings-menu ul {
	padding: 0;
}

.settings-menu li {
	font-size: 1.125rem;
	list-style: none;
}

.settings-menu button {
	color: var(--body-color-muted);
	width: 100%;
	height: 100%;
	display: inline-block;
	text-align: left;
}

.settings-menu li:not(:last-of-type) button {
	margin-bottom: 0.45em;
}

/* The icon box and its gap are em: at the big scales an 18px box put the
 * glyph on top of the label. */
.settings-menu button::before {
	width: 1em;
	height: 1em;
	display: inline-block;
	content: "";
	margin-right: 0.45em;
}

.settings-menu .appearance::before {
	content: "\f108"; /* http://fontawesome.io/icon/desktop/ */
}

.settings-menu .account::before {
	content: "\f007"; /* http://fontawesome.io/icon/user/ */
}

.settings-menu .messages::before {
	content: "\f0e0"; /* http://fontawesome.io/icon/envelope/ */
}

.settings-menu .notifications::before {
	content: "\f0f3"; /* http://fontawesome.io/icon/bell/ */
}

.settings-menu .general::before {
	content: "\f013"; /* http://fontawesome.io/icon/cog/ */
}

.settings-menu .networks::before {
	content: "\f233"; /* https://fontawesome.com/icons/server */
}

.settings-menu .aliases::before {
	content: "\f120"; /* https://fontawesome.com/icons/terminal */
}

.settings-menu button:hover,
.settings-menu button.active {
	color: var(--body-color);
}

.settings-menu button.active {
	cursor: default;
}
</style>

<script lang="ts">
import SettingTabItem from "./SettingTabItem.vue";
import {defineComponent, nextTick, onMounted, watch} from "vue";
import {useRoute} from "vue-router";
import {useStore} from "../../js/store";
import {brandingFeatures} from "../../js/branding";
import {shouldShowGeneralSettings} from "../../js/helpers/settingsTabs";

export default defineComponent({
	name: "SettingsTabs",
	components: {
		SettingTabItem,
	},
	setup() {
		const store = useStore();
		const route = useRoute();
		const isPublic = store.state.serverConfiguration?.public;

		// As a horizontal strip the menu scrolls, so the active tab may sit
		// off screen (opening Aliases from a deep link, or coming back to
		// the tab the user left). `nearest` makes this a no-op in the wide
		// layout, where nothing overflows.
		const revealActive = () => {
			void nextTick(() => {
				document
					.querySelector(".settings-menu button.active")
					?.scrollIntoView({inline: "nearest", block: "nearest"});
			});
		};

		onMounted(revealActive);
		watch(() => route.name, revealActive);

		return {
			isPublic,
			showGeneral: shouldShowGeneralSettings(),
			showNetworks: brandingFeatures(store.state.branding).saveNetworks,
		};
	},
});
</script>
