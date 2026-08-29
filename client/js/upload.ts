// File uploads.
//
// TheLounge uploaded to its own Node server (`POST /uploads/new/<token>`).
// Seance has no server, so the file goes straight from the browser to an
// uploader the network runs itself, configured per deploy through
// `uploads` in `config.json` (see docs/resources/branding.md). Without that
// entry the upload button stays hidden and dropped/pasted files are ignored
// after a single "not configured" notice.

import {update as updateCursor} from "undate";

import {BrandingUploads, DEFAULT_UPLOAD_MAX_BYTES} from "./branding";
import type {TypedStore} from "./store";

export const UPLOADS_NOT_CONFIGURED = "File uploads are not configured in this client.";

/** Everything the uploader needs from the app, so it can run without the store. */
export interface UploadHost {
	/** Uploader config from branding; `undefined` when uploads are off. */
	uploads(): BrandingUploads | undefined;
	isConnected(): boolean;
	/** Re-encode images through a canvas before upload (strips EXIF). */
	renderCanvas(): boolean;
	showError(message: string): void;
	insertUrl(url: string): void;
}

export class UploadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UploadError";
	}
}

export interface UploadFileOptions {
	/** Fetch implementation; defaults to the global `fetch`. */
	fetch?: typeof fetch;
	signal?: AbortSignal;
	/** Names of `config.fields` to leave out of this attempt. */
	omitFields?: ReadonlySet<string>;
}

/** Effective size limit for a config, in bytes. */
export function uploadMaxSize(config: BrandingUploads | undefined): number {
	return config?.maxSizeBytes ?? DEFAULT_UPLOAD_MAX_BYTES;
}

/**
 * Whether `type` is one the endpoint takes. Entries are exact MIME types or
 * `type/*` wildcards; no `accept` list at all means anything goes.
 */
export function acceptsType(config: BrandingUploads, type: string): boolean {
	if (!config.accept?.length) {
		return true;
	}

	const actual = type.toLowerCase();

	return config.accept.some((entry) => {
		const allowed = entry.trim().toLowerCase();

		return allowed.endsWith("/*")
			? actual.startsWith(allowed.slice(0, -1))
			: allowed === actual;
	});
}

/** Build the multipart `POST` for `file` as the configured endpoint expects it. */
export function buildUploadRequest(
	file: File,
	config: BrandingUploads,
	omitFields: ReadonlySet<string> = new Set()
): RequestInit {
	const body = new FormData();
	body.append(config.fieldName ?? "file", file, file.name);

	for (const [name, value] of Object.entries(config.fields ?? {})) {
		if (!omitFields.has(name)) {
			body.append(name, value);
		}
	}

	const headers: Record<string, string> = {};

	for (const [name, value] of Object.entries(config.headers ?? {})) {
		// The browser must set the multipart boundary itself.
		if (name.toLowerCase() !== "content-type") {
			headers[name] = value;
		}
	}

	return {
		method: "POST",
		body,
		headers,
		credentials: config.withCredentials ? "include" : "omit",
		mode: "cors",
	};
}

function absoluteUrl(candidate: string, base: string): string | undefined {
	try {
		const url = new URL(candidate.trim(), base);
		return /^https?:$/.test(url.protocol) ? url.href : undefined;
	} catch (e) {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The string at `path` in a parsed JSON body, or `undefined`.
 *
 * A plain top-level key is tried first, so a key that happens to contain a
 * dot keeps working; otherwise the path is split and walked through objects
 * and arrays alike (`results.0.filePath`).
 */
export function lookupResponsePath(body: unknown, path: string): string | undefined {
	const literal: unknown = isRecord(body) ? body[path] : undefined;

	if (typeof literal === "string") {
		return literal;
	}

	let value: unknown = body;

	for (const segment of path.split(".")) {
		if (Array.isArray(value)) {
			const index = Number(segment);
			value = Number.isInteger(index) ? value[index] : undefined;
		} else if (isRecord(value)) {
			value = value[segment];
		} else {
			return undefined;
		}
	}

	return typeof value === "string" ? value : undefined;
}

/** The uploader's own failure message for a parsed body, if it gave one. */
function responseError(body: unknown, config: BrandingUploads): string | undefined {
	const message = lookupResponsePath(body, config.responseErrorKey ?? "error");
	return message !== undefined && message.length > 0 ? message : undefined;
}

/**
 * Extract the public URL from an uploader response body: JSON at the
 * configured key or path (default `url`), or a plain-text body that is a URL.
 * Relative URLs resolve against the endpoint. Throws `UploadError` otherwise.
 */
export function parseUploadResponse(body: string, config: BrandingUploads): string {
	const key = config.responseUrlKey ?? "url";
	let parsed: unknown;

	try {
		parsed = JSON.parse(body);
	} catch (e) {
		parsed = undefined;
	}

	if (isRecord(parsed) || Array.isArray(parsed)) {
		const value = lookupResponsePath(parsed, key);

		if (value !== undefined) {
			const url = absoluteUrl(value, config.endpoint);

			if (url !== undefined) {
				return url;
			}
		}

		const message = responseError(parsed, config);

		if (message !== undefined) {
			throw new UploadError(message);
		}

		throw new UploadError(`Upload failed: the uploader did not return a "${key}" URL`);
	}

	if (typeof parsed === "string") {
		body = parsed;
	}

	const url = /^\s*https?:\/\/\S+\s*$/i.test(body)
		? absoluteUrl(body, config.endpoint)
		: undefined;

	if (url === undefined) {
		throw new UploadError("Upload failed: the uploader did not return a URL");
	}

	return url;
}

/**
 * Which of the config's `optionalFields` this error message blames, so the
 * upload can be retried without them.
 *
 * The name is matched by its words, since a service complains about "EXIF
 * metadata" rather than about `strip_exif` — the same heuristic poxchat uses
 * for its own strip fallback.
 */
export function fieldsBlamedBy(
	message: string,
	config: BrandingUploads,
	alreadyOmitted: ReadonlySet<string> = new Set()
): string[] {
	const text = message.toLowerCase();

	return (config.optionalFields ?? []).filter((name) => {
		if (alreadyOmitted.has(name) || config.fields?.[name] === undefined) {
			return false;
		}

		return name
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.some((word) => word.length >= 3 && text.includes(word));
	});
}

/**
 * Upload one file and resolve with its public URL; rejects with
 * `UploadError`. An upload the server refuses on account of an optional form
 * field is retried without it.
 */
export async function uploadFile(
	file: File,
	config: BrandingUploads,
	options: UploadFileOptions = {}
): Promise<string> {
	const omitFields = new Set(options.omitFields ?? []);

	for (;;) {
		try {
			return await uploadAttempt(file, config, {...options, omitFields});
		} catch (e: unknown) {
			// Each pass drops at least one field, so this terminates.
			const blamed =
				e instanceof UploadError ? fieldsBlamedBy(e.message, config, omitFields) : [];

			if (blamed.length === 0) {
				throw e;
			}

			for (const name of blamed) {
				omitFields.add(name);
			}
		}
	}
}

/** One `POST` of `file`, without the retry. */
async function uploadAttempt(
	file: File,
	config: BrandingUploads,
	options: UploadFileOptions
): Promise<string> {
	const doFetch = options.fetch ?? (typeof fetch === "function" ? fetch : undefined);

	if (doFetch === undefined) {
		throw new UploadError("Upload failed: fetch is not available");
	}

	const init: RequestInit = {
		...buildUploadRequest(file, config, options.omitFields),
		signal: options.signal,
	};
	let response: Response;

	try {
		response = await doFetch(config.endpoint, init);
	} catch (e: unknown) {
		if (e instanceof Error && e.name === "AbortError") {
			throw new UploadError("Upload cancelled");
		}

		const reason = e instanceof Error ? e.message : String(e);
		throw new UploadError(`Upload failed: ${reason}`);
	}

	let body = "";

	try {
		body = await response.text();
	} catch (e) {
		body = "";
	}

	if (!response.ok) {
		let message = `Upload failed: HTTP ${response.status}`;

		try {
			message = responseError(JSON.parse(body), config) ?? message;
		} catch (e) {
			// Not JSON; keep the status line.
		}

		throw new UploadError(message);
	}

	return parseUploadResponse(body, config);
}

/** Insert `url` at the cursor of the chat input, padded with spaces. */
export function insertUploadUrl(url: string): void {
	const textbox = document.getElementById("input");

	if (!(textbox instanceof HTMLTextAreaElement)) {
		throw new Error("Could not find textbox in upload");
	}

	const initStart = textbox.selectionStart;

	// Get the text before the cursor, and add a space if it's not in the beginning
	const headToCursor = initStart > 0 ? textbox.value.substring(0, initStart) + " " : "";

	// Get the remaining text after the cursor
	const cursorToTail = textbox.value.substring(initStart);

	// Construct the value until the point where we want the cursor to be
	const textBeforeTail = headToCursor + url + " ";

	updateCursor(textbox, textBeforeTail + cursorToTail);

	// Set the cursor after the link and a space
	textbox.selectionStart = textbox.selectionEnd = textBeforeTail.length;
}

/** The app's `UploadHost`: branding, connection state and errors via the store. */
export function storeUploadHost(store: TypedStore): UploadHost {
	return {
		uploads: () => store.state.branding.uploads,
		isConnected: () => store.state.isConnected,
		renderCanvas: () => store.state.settings.uploadCanvas,
		showError: (message) => store.commit("currentUserVisibleError", message),
		insertUrl: insertUploadUrl,
	};
}

export class Uploader {
	host: UploadHost | null;
	fileQueue: File[] = [];
	/** Controller of the upload in flight, if any. */
	controller: AbortController | null = null;
	fetchImpl: typeof fetch | undefined;
	/** The "not configured" notice is shown once per page, not per drop. */
	warnedUnconfigured = false;

	overlay: HTMLDivElement | null = null;
	uploadProgressbar: HTMLSpanElement | null = null;

	private drain: Promise<void> | null = null;

	onDragEnter = (e: DragEvent) => this.dragEnter(e);
	onDragOver = (e: DragEvent) => this.dragOver(e);
	onDragLeave = (e: DragEvent) => this.dragLeave(e);
	onDrop = (e: DragEvent) => this.drop(e);
	onPaste = (e: ClipboardEvent) => this.paste(e);

	constructor(host: UploadHost | null = null, fetchImpl?: typeof fetch) {
		this.host = host;
		this.fetchImpl = fetchImpl;
	}

	init() {
		// Nothing to subscribe to: uploads go straight to the configured endpoint.
	}

	mounted(host: UploadHost | null = this.host) {
		this.host = host;
		this.overlay = document.getElementById("upload-overlay") as HTMLDivElement;
		this.uploadProgressbar = document.getElementById("upload-progressbar") as HTMLSpanElement;

		document.addEventListener("dragenter", this.onDragEnter);
		document.addEventListener("dragover", this.onDragOver);
		document.addEventListener("dragleave", this.onDragLeave);
		document.addEventListener("drop", this.onDrop);
		document.addEventListener("paste", this.onPaste);
	}

	unmounted() {
		document.removeEventListener("dragenter", this.onDragEnter);
		document.removeEventListener("dragover", this.onDragOver);
		document.removeEventListener("dragleave", this.onDragLeave);
		document.removeEventListener("drop", this.onDrop);
		document.removeEventListener("paste", this.onPaste);
	}

	dragOver(event: DragEvent) {
		if (event.dataTransfer?.types.includes("Files")) {
			// Prevent dragover event completely and do nothing with it
			// This stops the browser from trying to guess which cursor to show
			event.preventDefault();
		}
	}

	dragEnter(event: DragEvent) {
		// relatedTarget is the target where we entered the drag from
		// when dragging from another window, the target is null, otherwise its a DOM element
		if (!event.relatedTarget && event.dataTransfer?.types.includes("Files")) {
			event.preventDefault();

			if (this.host?.uploads()) {
				this.overlay?.classList.add("is-dragover");
			}
		}
	}

	dragLeave(event: DragEvent) {
		// If relatedTarget is null, that means we are no longer dragging over the page
		if (!event.relatedTarget) {
			event.preventDefault();
			this.overlay?.classList.remove("is-dragover");
		}
	}

	drop(event: DragEvent) {
		if (!event.dataTransfer?.types.includes("Files")) {
			return;
		}

		// Always swallow the drop: the browser would otherwise navigate away
		// to the dropped file, configured uploader or not.
		event.preventDefault();
		this.overlay?.classList.remove("is-dragover");

		let files: (File | null)[];

		if (event.dataTransfer.items) {
			files = Array.from(event.dataTransfer.items)
				.filter((item) => item.kind === "file")
				.map((item) => item.getAsFile());
		} else {
			files = Array.from(event.dataTransfer.files);
		}

		void this.triggerUpload(files);
	}

	paste(event: ClipboardEvent) {
		const items = event.clipboardData?.items;
		const files: (File | null)[] = [];

		if (!items) {
			return;
		}

		for (let i = 0; i < items.length; i++) {
			if (items[i].kind === "file") {
				files.push(items[i].getAsFile());
			}
		}

		if (files.length === 0) {
			return;
		}

		event.preventDefault();
		void this.triggerUpload(files);
	}

	/**
	 * Queue files for upload. Resolves once the queue has drained (every
	 * file uploaded or reported), so callers can await the outcome.
	 */
	triggerUpload(files: (File | null)[]): Promise<void> {
		if (!files.length || !this.host) {
			return Promise.resolve();
		}

		const config = this.host.uploads();

		if (!config) {
			if (!this.warnedUnconfigured) {
				this.warnedUnconfigured = true;
				this.host.showError(UPLOADS_NOT_CONFIGURED);
			}

			return Promise.resolve();
		}

		if (!this.host.isConnected()) {
			this.host.showError(
				"You are currently disconnected, unable to initiate upload process."
			);

			return Promise.resolve();
		}

		const maxFileSize = uploadMaxSize(config);

		for (const file of files) {
			if (!file) {
				continue;
			}

			if (file.size > maxFileSize) {
				this.host.showError(`File ${file.name} is over the maximum allowed size`);
				continue;
			}

			// Refuse here rather than letting the endpoint answer: the boxlabs
			// preset points at an image staging service, so a dropped video
			// should say so plainly.
			if (!acceptsType(config, file.type)) {
				const accepted = (config.accept ?? []).join(", ");
				this.host.showError(
					`File ${file.name} is not a type this uploader accepts (${accepted})`
				);
				continue;
			}

			this.fileQueue.push(file);
		}

		if (this.fileQueue.length === 0) {
			return this.drain ?? Promise.resolve();
		}

		if (this.drain === null) {
			this.drain = this.drainQueue().finally(() => {
				this.drain = null;
			});
		}

		return this.drain;
	}

	private async drainQueue(): Promise<void> {
		let file = this.fileQueue.shift();

		while (file !== undefined) {
			await this.uploadOne(file);
			file = this.fileQueue.shift();
		}
	}

	private async uploadOne(file: File): Promise<void> {
		const host = this.host;
		const config = host?.uploads();

		if (!host || !config) {
			return;
		}

		this.controller = new AbortController();
		this.setBusy(true);

		try {
			if (
				host.renderCanvas() &&
				file.type.startsWith("image/") &&
				!file.type.includes("svg") &&
				file.type !== "image/gif"
			) {
				file = await this.renderImage(file);
			}

			const url = await uploadFile(file, config, {
				fetch: this.fetchImpl,
				signal: this.controller.signal,
			});

			host.insertUrl(url);
		} catch (e: unknown) {
			host.showError(e instanceof Error ? e.message : String(e));
		} finally {
			this.controller = null;
			this.setBusy(false);
		}
	}

	/**
	 * `fetch` has no upload progress events, so the bar is a plain busy
	 * indicator: fully lit while a request is in flight.
	 */
	setBusy(busy: boolean) {
		if (!this.uploadProgressbar) {
			return;
		}

		this.uploadProgressbar.classList.toggle("upload-progressbar-visible", busy);
		this.uploadProgressbar.style.width = busy ? "100%" : "0%";
	}

	/** Re-draw an image through a canvas; falls back to the original file. */
	renderImage(file: File): Promise<File> {
		return new Promise((resolve) => {
			const fileReader = new FileReader();

			fileReader.onabort = () => resolve(file);
			fileReader.onerror = () => fileReader.abort();

			fileReader.onload = () => {
				const img = new Image();

				img.onerror = () => resolve(file);

				img.onload = () => {
					const canvas = document.createElement("canvas");
					canvas.width = img.width;
					canvas.height = img.height;
					const ctx = canvas.getContext("2d");

					if (!ctx) {
						resolve(file);
						return;
					}

					ctx.drawImage(img, 0, 0);

					canvas.toBlob((blob) => {
						resolve(blob ? new File([blob], file.name, {type: file.type}) : file);
					}, file.type);
				};

				img.src = String(fileReader.result);
			};

			fileReader.readAsDataURL(file);
		});
	}

	abort() {
		this.fileQueue = [];

		if (this.controller) {
			this.controller.abort();
			this.controller = null;
		}
	}
}

const instance = new Uploader();

export default {
	abort: () => instance.abort(),
	initialize: () => instance.init(),
	/** Attach the drag/drop/paste listeners, reading config and state from `store`. */
	mounted: (store: TypedStore) => instance.mounted(storeUploadHost(store)),
	unmounted: () => instance.unmounted(),
	triggerUpload: (files: (File | null)[]) => void instance.triggerUpload(files),
};
