/**
 * Turns a transport close into user-readable feedback. Browsers deliberately
 * hide *why* a WebSocket failed (no error text, close code 1006 for refused,
 * unreachable, TLS and mixed-content failures alike, so pages cannot probe the
 * local network) — but the client knows how far the attempt got and what kind
 * of URL it was dialling, which is enough to say something useful.
 *
 * Store/DOM-free (runs under mocha); the caller passes the page protocol in.
 */

/** How far the connection got before it closed. */
export type ClosePhase = "connecting" | "registering" | "registered";

export interface CloseContext {
	/** The WebSocket URL that was dialled, e.g. `wss://irc.example.org:8443/`. */
	url: string;
	/** Host as the user typed it, for the headline. */
	host: string;
	phase: ClosePhase;
	code: number;
	/** Server-supplied close reason, usually empty. */
	reason: string;
	/** Last transport error text; browsers only ever say "WebSocket error". */
	errorMessage?: string;
	/** `location.protocol` when running in a browser (`"https:"`, `"http:"`). */
	pageProtocol?: string;
	willReconnect: boolean;
}

export interface CloseReport {
	/** The headline, pushed as an error message. */
	text: string;
	/** Optional follow-up line explaining likely causes / what to try. */
	hint?: string;
}

/** RFC 6455 close codes worth spelling out instead of "(code N)". */
const CLOSE_CODES: Record<number, string> = {
	1001: "server going away",
	1002: "WebSocket protocol error",
	1006: "connection lost",
	1008: "policy violation",
	1009: "message too large",
	1011: "server error",
	1012: "server restarting",
	1013: "server asked to try again later",
	1015: "TLS handshake failed",
};

/** `(reason)` / `(connection lost)` / `(code 4000)` — or "" for a clean 1000. */
function closeDetail(code: number, reason: string): string {
	if (reason) {
		return ` (${reason})`;
	}

	if (code === 1000) {
		return "";
	}

	const name = CLOSE_CODES[code];
	return name ? ` (${name})` : ` (code ${code})`;
}

/** True when the transport error text says more than the browser's stock event. */
function informative(message: string | undefined): message is string {
	return message !== undefined && message.length > 0 && message !== "WebSocket error";
}

export function describeClose(ctx: CloseContext): CloseReport {
	const notAgain = ctx.willReconnect ? "" : " Not reconnecting.";

	if (ctx.phase === "connecting") {
		// The socket never opened: the browser knows why but will not tell us.
		const error = informative(ctx.errorMessage) ? ` (${ctx.errorMessage})` : "";
		const text = `Could not connect to ${ctx.url}${error}.${notAgain}`;
		const secure = ctx.url.startsWith("wss:");

		if (!secure && ctx.pageProtocol === "https:") {
			return {
				text,
				hint:
					"This page was loaded over HTTPS, so the browser blocks plain ws:// " +
					"connections. Enable TLS for this network, or open the app over http://.",
			};
		}

		if (secure) {
			return {
				text,
				hint:
					"The browser does not reveal why. Likely causes: the server is down, the " +
					"port is wrong, or its TLS certificate is not trusted — for a self-signed " +
					`certificate, open ${ctx.url.replace(/^wss:/, "https:")} in a new tab, ` +
					"accept the warning, then reconnect.",
			};
		}

		return {
			text,
			hint:
				"The browser does not reveal why. Likely causes: the server is down, the " +
				"port is wrong, or it does not accept WebSocket connections on that port.",
		};
	}

	if (ctx.phase === "registering") {
		return {
			text: `Connection to ${ctx.host} closed during IRC registration${closeDetail(
				ctx.code,
				ctx.reason
			)}.${notAgain}`,
			hint:
				"The WebSocket opened but the server dropped it before registration " +
				"finished — check that this port really speaks IRC over WebSocket, and " +
				"look for a server notice above for the reason.",
		};
	}

	return {
		text: `Disconnected from ${ctx.host}${closeDetail(ctx.code, ctx.reason)}.${notAgain}`,
	};
}
