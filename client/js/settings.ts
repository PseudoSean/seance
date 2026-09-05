import type {TypedStore} from "./store";
import {mirrorPushPrefs} from "./push-prefs";

const defaultSettingConfig = {
	apply() {},
	default: null,
	sync: null,
};

const defaultConfig = {
	advanced: {
		default: false,
	},
	autocomplete: {
		default: true,
	},
	nickPostfix: {
		default: "",
	},
	coloredNicks: {
		default: true,
	},
	highlightMessages: {
		default: true,
	},
	highlights: {
		default: "",
		sync: "always",
	},
	highlightExceptions: {
		default: "",
		sync: "always",
	},
	awayMessage: {
		default: "",
		sync: "always",
	},
	links: {
		default: true,
	},
	markdown: {
		default: true,
		// Mirrored to the service worker (it cannot read localStorage) so a
		// push notification strips Markdown exactly when the page renders it;
		// applyAll runs this at boot too.
		apply(store: TypedStore, value: boolean) {
			void mirrorPushPrefs({markdown: value});
		},
	},
	motd: {
		default: true,
	},
	notification: {
		default: true,
		sync: "never",
	},
	notifyAllMessages: {
		default: false,
	},
	showSeconds: {
		default: false,
	},
	use12hClock: {
		default: false,
	},
	statusMessages: {
		default: "condensed",
	},
	/** A server's push identity (VAPID key) changed: ask | trust | ignore
	 * (client/js/webpush.ts, helpers/pushKeys.ts keyChangePolicy). */
	pushKeyChange: {
		default: "ask",
	},
	theme: {
		default: document.getElementById("theme")?.dataset.serverTheme,
		apply(store: TypedStore, value: string) {
			const themeEl = document.getElementById("theme");
			const themeUrl = `themes/${value}.css`;

			if (!(themeEl instanceof HTMLLinkElement)) {
				throw new Error("theme element is not a link");
			}

			const hrefAttr = themeEl.attributes.getNamedItem("href");

			if (!hrefAttr) {
				throw new Error("theme is missing href attribute");
			}

			if (hrefAttr.value === themeUrl) {
				return;
			}

			hrefAttr.value = themeUrl;

			if (!store.state.serverConfiguration) {
				return;
			}

			const newTheme = store.state.serverConfiguration?.themes.filter(
				(theme) => theme.name === value
			)[0];

			const metaSelector = document.querySelector('meta[name="theme-color"]');

			if (!(metaSelector instanceof HTMLMetaElement)) {
				throw new Error("theme meta element is not a meta element");
			}

			if (metaSelector) {
				const themeColor = newTheme.themeColor || metaSelector.content;
				metaSelector.content = themeColor;
			}
		},
	},
	media: {
		default: true,
	},
	// "click": media previews show a placeholder until the reader reveals them
	// (or trusts the host, helpers/mediaTrust.ts); "always": load at once.
	mediaReveal: {
		default: "click",
	},
	uploadCanvas: {
		default: true,
	},
	// Report own input activity as `+typing` TAGMSGs (IRCv3 typing client tag).
	sendTypingNotifications: {
		default: true,
	},
	userStyles: {
		default: "",
		apply(store: TypedStore, value: string) {
			if (!/[?&]nocss/.test(window.location.search)) {
				const element = document.getElementById("user-specified-css");

				if (element) {
					element.innerHTML = value;
				}
			}
		},
	},
	// Search is local (client/js/search.ts) and always available.
	searchEnabled: {
		default: true,
	},
};

export const config = normalizeConfig(defaultConfig);

export function createState() {
	const state = {};

	for (const settingName in config) {
		state[settingName] = config[settingName].default;
	}

	return state;
}

function normalizeConfig(obj: any) {
	const newConfig: Partial<typeof defaultConfig> = {};

	for (const settingName in obj) {
		newConfig[settingName] = {...defaultSettingConfig, ...obj[settingName]};
	}

	return newConfig as typeof defaultConfig;
}

// flatten to type of default
export type SettingsState = {
	[key in keyof typeof defaultConfig]: typeof defaultConfig[key]["default"];
};
