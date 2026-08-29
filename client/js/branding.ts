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

/**
 * A network-provided file uploader. Seance has no server of its own, so
 * uploads go straight from the browser to this endpoint; see the "Uploads"
 * section of docs/resources/branding.md for the contract it must satisfy.
 */
export interface BrandingUploads {
	/**
	 * Named service preset filling in the fields below; anything given
	 * explicitly alongside it wins. See `UPLOAD_PRESETS`.
	 */
	preset?: string;
	/** Absolute `https:` URL that accepts a multipart `POST`. */
	endpoint: string;
	/** Client-side size limit in bytes. Default 10 MiB. */
	maxSizeBytes?: number;
	/** Multipart form field carrying the file. Default `"file"`. */
	fieldName?: string;
	/** Extra multipart fields sent alongside the file, e.g. `strip_exif=1`. */
	fields?: Record<string, string>;
	/**
	 * Names of `fields` that may be dropped for one retry when the uploader
	 * answers with an error that names them — a server that cannot strip
	 * metadata off this particular file should still take the upload.
	 */
	optionalFields?: string[];
	/**
	 * JSON key holding the public URL in the response. Default `"url"`. A
	 * dotted path indexes into nested objects and arrays
	 * (`"results.0.filePath"`). A plain-text response body that is itself a
	 * URL is accepted too.
	 */
	responseUrlKey?: string;
	/** Same, for the failure message. Default `"error"`. */
	responseErrorKey?: string;
	/**
	 * MIME types the endpoint accepts. Anything else is refused before the
	 * upload starts, so the user gets a clear message instead of the
	 * service's own. Absent means "send whatever".
	 */
	accept?: string[];
	/** Send cookies/credentials with the request. Default false. */
	withCredentials?: boolean;
	/** Extra request headers, e.g. an API key. */
	headers?: Record<string, string>;
}

/**
 * Ready-made uploader configurations, selected with `uploads.preset`.
 *
 * `boxlabs-paste` is the anonymous image staging endpoint of
 * [PASTE](https://github.com/boxlabss/PASTE) that poxchat uploads to; no API
 * key (the documented `api.php` needs one, but it only covers text pastes).
 * It answers `{"results":[{"success":true,"filePath":"/img/img_x.png"}]}` or
 * `{"results":[{"success":false,"error":"…"}]}`, and `filePath` is relative
 * to the endpoint.
 */
export const UPLOAD_PRESETS: Record<string, BrandingUploads> = {
	"boxlabs-paste": {
		endpoint: "https://paste.boxlabs.uk/img/",
		fieldName: "images[]",
		fields: {strip_exif: "1"},
		optionalFields: ["strip_exif"],
		responseUrlKey: "results.0.filePath",
		responseErrorKey: "results.0.error",
		// The endpoint is `/img/`: it takes images, not video.
		accept: ["image/png", "image/jpeg", "image/gif", "image/webp"],
		maxSizeBytes: 10 * 1024 * 1024,
	},
};

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
	/** File uploader endpoint. Absent means uploads are off. */
	uploads?: BrandingUploads;
}

/** Upload size limit applied when `uploads.maxSizeBytes` is unset. */
export const DEFAULT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

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
		// Deploys override these with the network's own pages.
		website: "https://github.com/evilnet/seance",
		help: "https://github.com/evilnet/seance/tree/develop/docs",
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

function normalizeHeaders(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const headers: Record<string, string> = {};

	for (const [name, text] of Object.entries(value)) {
		if (typeof text === "string" && name.trim().length > 0) {
			headers[name.trim()] = text;
		}
	}

	return Object.keys(headers).length > 0 ? headers : undefined;
}

/** A map of plain strings, e.g. extra form fields; `undefined` when empty. */
function normalizeStringMap(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const map: Record<string, string> = {};

	for (const [key, entry] of Object.entries(value)) {
		const text = optionalString(entry);

		if (key.trim().length > 0 && text !== undefined) {
			map[key.trim()] = text;
		}
	}

	return Object.keys(map).length > 0 ? map : undefined;
}

/** A list of non-empty strings, e.g. MIME types; `undefined` when empty. */
function normalizeStringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const list = value
		.map((entry) => optionalString(entry))
		.filter((entry): entry is string => entry !== undefined);

	return list.length > 0 ? list : undefined;
}

function normalizeUploads(value: unknown): BrandingUploads | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	// A preset supplies the endpoint and wire details; explicit keys win, so a
	// deploy can point the preset at its own PASTE instance.
	const presetName = optionalString(value.preset);
	const preset = presetName !== undefined ? UPLOAD_PRESETS[presetName] : undefined;

	if (presetName !== undefined && preset === undefined) {
		return undefined;
	}

	const endpoint = optionalString(value.endpoint) ?? preset?.endpoint;

	// Uploads leave the app's origin, so only a real https URL counts.
	if (endpoint === undefined || !/^https:\/\/[^/?#]+/i.test(endpoint)) {
		return undefined;
	}

	// Copy the preset's containers: the returned config must not alias the
	// module-level constant.
	const uploads: BrandingUploads = {...preset, endpoint};

	if (preset?.fields) {
		uploads.fields = {...preset.fields};
	}

	if (preset?.optionalFields) {
		uploads.optionalFields = [...preset.optionalFields];
	}

	if (preset?.accept) {
		uploads.accept = [...preset.accept];
	}

	if (presetName !== undefined) {
		uploads.preset = presetName;
	}

	const maxSizeBytes =
		typeof value.maxSizeBytes === "string" ? Number(value.maxSizeBytes) : value.maxSizeBytes;
	const fieldName = optionalString(value.fieldName);
	const fields = normalizeStringMap(value.fields);
	const optionalFields = normalizeStringList(value.optionalFields);
	const responseUrlKey = optionalString(value.responseUrlKey);
	const responseErrorKey = optionalString(value.responseErrorKey);
	const accept = normalizeStringList(value.accept);
	const withCredentials = optionalBoolean(value.withCredentials);
	const headers = normalizeHeaders(value.headers);

	if (typeof maxSizeBytes === "number" && Number.isFinite(maxSizeBytes) && maxSizeBytes > 0) {
		uploads.maxSizeBytes = Math.floor(maxSizeBytes);
	}

	if (fieldName !== undefined) {
		uploads.fieldName = fieldName;
	}

	if (fields !== undefined) {
		uploads.fields = fields;
	}

	if (optionalFields !== undefined) {
		uploads.optionalFields = optionalFields;
	}

	if (responseUrlKey !== undefined) {
		uploads.responseUrlKey = responseUrlKey;
	}

	if (responseErrorKey !== undefined) {
		uploads.responseErrorKey = responseErrorKey;
	}

	if (accept !== undefined) {
		uploads.accept = accept;
	}

	if (withCredentials !== undefined) {
		uploads.withCredentials = withCredentials;
	}

	if (headers !== undefined) {
		uploads.headers = headers;
	}

	return uploads;
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
	const uploads = normalizeUploads(source.uploads) ?? defaults.uploads;

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

	if (uploads !== undefined) {
		config.uploads = uploads;
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
