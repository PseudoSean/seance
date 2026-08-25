// Deployment branding.
//
// A deploy of the built `public/` tree is rebranded without rebuilding by
// editing `public/config.json`. `loadBranding()` fetches that file at boot,
// validates it and merges it over `DEFAULT_BRANDING`; everything the SPA
// renders (title, connect form defaults, help links, ...) reads from the
// result via `getBranding()` or `store.state.branding`.
//
// The same file is also read by webpack at build time to fill in the parts of
// `index.html` that must exist before any JavaScript runs (`<title>`,
// `theme-color`, the loading splash). See docs/resources/branding.md.

export interface BrandingNetwork {
	/** Display name for the network (defaults to the host name). */
	name?: string;
	host: string;
	port?: number;
	tls?: boolean;
	channels?: string[];
	/** Default nick; every `?` (or `%`, TheLounge style) becomes a random digit. */
	nick?: string;
	/** Hide the host/port/TLS fields on the connect form. */
	lockHost?: boolean;
}

export interface BrandingLinks {
	website?: string;
	help?: string;
	privacy?: string;
}

export interface BrandingFeatures {
	/** Allow connecting to more than one network at a time. Default true. */
	multiNetwork?: boolean;
	/** Show the saved-networks picker on the connect form. Default true. */
	saveNetworks?: boolean;
	/**
	 * Allow connecting to servers other than `defaultNetwork`. Default true.
	 * `false` hides the host/port/TLS fields and pins them to the default.
	 */
	allowCustomServer?: boolean;
}

export interface BrandingConfig {
	appName: string;
	shortName?: string;
	description?: string;
	defaultNetwork?: BrandingNetwork;
	/** Default theme name (must exist in the build's theme list). */
	theme?: string;
	/** Browser chrome colour (`<meta name="theme-color">`). */
	themeColor?: string;
	links?: BrandingLinks;
	features?: BrandingFeatures;
	/** Overrides for a small set of UI strings, keyed like `connect.title`. */
	strings?: Record<string, string>;
}

/** Keys accepted in `strings`, with the copy used when not overridden. */
export const BRANDING_STRINGS: Record<string, string> = {
	"connect.title": "Connect to IRC",
	"connect.savedNetworks": "Saved networks",
	"connect.savedNetworksEmpty":
		"No saved networks yet. Networks you connect to are remembered here.",
	"connect.submit": "Connect",
	"help.about": "About",
	"help.website": "Website",
	"help.documentation": "Documentation",
	"help.privacy": "Privacy policy",
};

export const DEFAULT_BRANDING: BrandingConfig = {
	appName: "Seance",
	defaultNetwork: undefined,
	links: {
		// Upstream attribution: the client is derived from The Lounge and its
		// documentation still applies to most of the UI.
		website: "https://thelounge.chat/",
		help: "https://thelounge.chat/docs/",
	},
	features: {
		multiNetwork: true,
		saveNetworks: true,
		allowCustomServer: true,
	},
	strings: {},
};

/** File fetched at boot, relative to the document (respects `<base href>`). */
export const BRANDING_FILE = "config.json";

let current: BrandingConfig = DEFAULT_BRANDING;
let warned = false;

/** Branding as loaded by `loadBranding()`; `DEFAULT_BRANDING` before that. */
export function getBranding(): BrandingConfig {
	return current;
}

/** Overwrite the loaded branding (tests, or a host shell injecting its own). */
export function setBranding(config: BrandingConfig): BrandingConfig {
	current = config;
	return current;
}

/** Look up a UI string, honouring `strings` overrides from the config. */
export function brandingString(key: string, config: BrandingConfig = current): string {
	const override = config.strings?.[key];

	if (typeof override === "string" && override.length > 0) {
		return override;
	}

	return BRANDING_STRINGS[key] ?? key;
}

/**
 * Expand the nick placeholders of a default nick: every `?` or `%` becomes a
 * random digit, so `"guest????"` yields e.g. `"guest4821"`.
 */
export function expandNick(nick: string, random: () => number = Math.random): string {
	return nick.replace(/[?%]/g, () => String(Math.floor(random() * 10) % 10));
}

/** Resolved defaults from `features`, with unset flags filled in as `true`. */
export function brandingFeatures(config: BrandingConfig = current): Required<BrandingFeatures> {
	return {
		multiNetwork: config.features?.multiNetwork !== false,
		saveNetworks: config.features?.saveNetworks !== false,
		allowCustomServer: config.features?.allowCustomServer !== false,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function optionalPort(value: unknown): number | undefined {
	const port = typeof value === "string" ? Number(value) : value;

	if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
		return undefined;
	}

	return port;
}

function optionalUrl(value: unknown): string | undefined {
	const url = optionalString(value);

	if (url === undefined) {
		return undefined;
	}

	// Only http(s) links are ever rendered as anchors.
	return /^https?:\/\//i.test(url) ? url : undefined;
}

function normalizeChannels(value: unknown): string[] | undefined {
	const raw: unknown[] = Array.isArray(value)
		? value
		: typeof value === "string"
		? value.split(",")
		: [];

	const channels = raw
		.filter((chan): chan is string => typeof chan === "string")
		.map((chan) => chan.trim())
		.filter((chan) => chan.length > 0)
		.map((chan) => (/^[#&!+]/.test(chan) ? chan : `#${chan}`));

	return channels.length > 0 ? channels : undefined;
}

function normalizeNetwork(value: unknown): BrandingNetwork | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const host = optionalString(value.host);

	if (host === undefined) {
		return undefined;
	}

	const network: BrandingNetwork = {host};
	const name = optionalString(value.name);
	const port = optionalPort(value.port);
	const tls = optionalBoolean(value.tls);
	const channels = normalizeChannels(value.channels ?? value.join);
	const nick = optionalString(value.nick);
	const lockHost = optionalBoolean(value.lockHost);

	if (name !== undefined) {
		network.name = name;
	}

	if (port !== undefined) {
		network.port = port;
	}

	if (tls !== undefined) {
		network.tls = tls;
	}

	if (channels !== undefined) {
		network.channels = channels;
	}

	if (nick !== undefined) {
		network.nick = nick;
	}

	if (lockHost !== undefined) {
		network.lockHost = lockHost;
	}

	return network;
}

function normalizeStrings(value: unknown): Record<string, string> {
	const strings: Record<string, string> = {};

	if (!isRecord(value)) {
		return strings;
	}

	for (const [key, text] of Object.entries(value)) {
		if (typeof text === "string" && key in BRANDING_STRINGS) {
			strings[key] = text;
		}
	}

	return strings;
}

/**
 * Validate a parsed `config.json` and merge it over the defaults. Unknown or
 * malformed fields are dropped rather than failing the whole file, so a typo
 * in one field never takes the app down.
 */
export function normalizeBranding(
	raw: unknown,
	defaults: BrandingConfig = DEFAULT_BRANDING
): BrandingConfig {
	const source: Record<string, unknown> = isRecord(raw) ? raw : {};
	const rawLinks = isRecord(source.links) ? source.links : {};
	const rawFeatures = isRecord(source.features) ? source.features : {};

	const links: BrandingLinks = {};

	for (const key of ["website", "help", "privacy"] as const) {
		const link = optionalUrl(rawLinks[key]) ?? defaults.links?.[key];

		if (link !== undefined) {
			links[key] = link;
		}
	}

	const features: BrandingFeatures = {};

	for (const key of ["multiNetwork", "saveNetworks", "allowCustomServer"] as const) {
		features[key] = optionalBoolean(rawFeatures[key]) ?? defaults.features?.[key] ?? true;
	}

	const config: BrandingConfig = {
		appName: optionalString(source.appName) ?? defaults.appName,
		defaultNetwork: normalizeNetwork(source.defaultNetwork) ?? defaults.defaultNetwork,
		links,
		features,
		strings: {...defaults.strings, ...normalizeStrings(source.strings)},
	};

	const shortName = optionalString(source.shortName) ?? defaults.shortName;
	const description = optionalString(source.description) ?? defaults.description;
	const theme = optionalString(source.theme) ?? defaults.theme;
	const themeColor = optionalString(source.themeColor) ?? defaults.themeColor;

	if (shortName !== undefined) {
		config.shortName = shortName;
	}

	if (description !== undefined) {
		config.description = description;
	}

	if (theme !== undefined) {
		config.theme = theme;
	}

	if (themeColor !== undefined && /^#[0-9a-f]{3,8}$/i.test(themeColor)) {
		config.themeColor = themeColor;
	}

	return config;
}

/** `config.json` next to the document, so subpath deploys and `<base>` work. */
export function brandingUrl(): string {
	if (typeof document !== "undefined" && document.baseURI) {
		return new URL(BRANDING_FILE, document.baseURI).href;
	}

	return BRANDING_FILE;
}

export interface LoadBrandingOptions {
	/** Fetch implementation; defaults to the global `fetch`. */
	fetch?: typeof fetch;
	url?: string;
}

/**
 * Fetch and apply `config.json`. Never rejects: a missing or invalid file
 * falls back to the defaults and warns once on the console.
 */
export async function loadBranding(options: LoadBrandingOptions = {}): Promise<BrandingConfig> {
	const url = options.url ?? brandingUrl();
	const doFetch = options.fetch ?? (typeof fetch === "function" ? fetch : undefined);
	let raw: unknown = {};

	try {
		if (doFetch === undefined) {
			throw new Error("fetch is not available");
		}

		const response = await doFetch(url, {cache: "no-cache", credentials: "same-origin"});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		raw = await response.json();

		if (!isRecord(raw)) {
			throw new Error("not a JSON object");
		}
	} catch (e: unknown) {
		if (!warned) {
			warned = true;
			const reason = e instanceof Error ? e.message : String(e);
			// eslint-disable-next-line no-console
			console.warn(`Branding: could not load ${url} (${reason}); using defaults.`);
		}

		raw = {};
	}

	return setBranding(normalizeBranding(raw));
}

/** Test hook: forget the state left behind by an earlier `loadBranding()`. */
export function resetBranding(): void {
	current = DEFAULT_BRANDING;
	warned = false;
}
