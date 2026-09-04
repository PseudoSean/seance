// Deliver spec-shaped push lines to the REAL service worker and assert the
// notifications it shows — what `yarn test` cannot see. Speaks the DevTools
// protocol at browser level (tools/browser-drive.mjs attaches per page and
// cannot reach the worker target), like tmp/sw-reply-probe2.mjs.
//
//   tmp/chrome-pw.sh --remote-debugging-port=9333 about:blank &   # Playwright's Chromium on this rig
//   node tools/push-line-check.mjs --port=9333 --url=https://localhost:8000/
//
// The app must be served from a secure context (the dev origin) so the
// worker registers. Exits non-zero when an expectation fails.

const args = Object.fromEntries(
	process.argv.slice(2).map((a) => {
		const m = /^--([^=]+)=(.*)$/.exec(a);
		return m ? [m[1], m[2]] : [a, true];
	})
);
const PORT = args.port ?? "9333";
const URL_ = args.url ?? "https://localhost:8000/";
const ORIGIN = new URL(URL_).origin;

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const call = (method, params = {}, sessionId) =>
	new Promise((res, rej) => {
		const m = ++id;
		pending.set(m, {res, rej});
		ws.send(JSON.stringify({id: m, method, params, sessionId}));
	});
ws.onmessage = (e) => {
	const m = JSON.parse(e.data);
	if (m.id && pending.has(m.id)) {
		const p = pending.get(m.id);
		pending.delete(m.id);
		m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
	}
};
await new Promise((r) => (ws.onopen = r));
await call("Target.setDiscoverTargets", {discover: true});
await call("Browser.grantPermissions", {permissions: ["notifications"], origin: ORIGIN});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const {targetId} = await call("Target.createTarget", {url: "about:blank"});
const {sessionId} = await call("Target.attachToTarget", {targetId, flatten: true});
await call("Runtime.enable", {}, sessionId);
await call("Page.enable", {}, sessionId);
await call("Page.navigate", {url: URL_}, sessionId);
const inPage = async (expression) => {
	const r = await call(
		"Runtime.evaluate",
		{expression, awaitPromise: true, returnByValue: true},
		sessionId
	);
	if (r.exceptionDetails)
		throw new Error(
			r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception)
		);
	return r.result.value;
};
await inPage("navigator.serviceWorker.ready.then(() => true)");

async function swEval() {
	const {targetInfos} = await call("Target.getTargets");
	const sw = targetInfos.find(
		(t) => t.type === "service_worker" && t.url.includes("service-worker.js")
	);
	if (!sw) throw new Error("no service worker target");
	const {sessionId: swSession} = await call("Target.attachToTarget", {
		targetId: sw.targetId,
		flatten: true,
	});
	await call("Runtime.enable", {}, swSession);
	return async (expression) => {
		const r = await call(
			"Runtime.evaluate",
			{expression, awaitPromise: true, returnByValue: true},
			swSession
		);
		if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
		return r.result.value;
	};
}
const inWorker = await swEval();

// the page writes the worker's prefs the way settings.ts does
const setMarkdown = (on) =>
	inPage(`new Promise((res, rej) => {
		const req = indexedDB.open("seance-push", 1);
		req.onupgradeneeded = () => req.result.createObjectStore("kv");
		req.onsuccess = () => {
			const tx = req.result.transaction("kv", "readwrite");
			tx.objectStore("kv").put({markdown: ${on}}, "prefs");
			tx.oncomplete = () => res(true);
			tx.onerror = () => rej(tx.error);
		};
	})`);
const clear = () =>
	inWorker(
		"self.registration.getNotifications().then((ns) => { ns.forEach((n) => n.close()); return ns.length; })"
	);
const deliver = (line) => inWorker(`handlePush(${JSON.stringify(line)}).then(() => true)`);
const shown = () =>
	inWorker(
		"self.registration.getNotifications().then((ns) => ns.map((n) => ({title: n.title, body: n.body, tag: n.tag, count: n.data && n.data.count})))"
	);

let failures = 0;
const check = (label, ok, got) => {
	console.log(`${ok ? "  ok " : "FAIL "} ${label}${ok ? "" : `: ${JSON.stringify(got)}`}`);
	if (!ok) failures++;
};
const T = "2026-09-04T10:20:30.123Z";
const RUN = Date.now().toString(36);

// 1. a single PM, markdown on: markers and formatting bytes gone
await setMarkdown(true);
await clear();
await deliver(
	`@msgid=pm${RUN};time=${T};account=alice :alice!u@h PRIVMSG me :\x02**hello**\x02 ${RUN}`
);
let ns = await shown();
check("one notification for the PM", ns.length === 1, ns);
check("PM body stripped", ns[0]?.body === `hello ${RUN}`, ns);
check("PM title is the sender", ns[0]?.title === "alice", ns);

// 2. the same msgid again: deduped by the worker's own merge, not doubled
await deliver(
	`@msgid=pm${RUN};time=${T};account=alice :alice!u@h PRIVMSG me :\x02**hello**\x02 ${RUN}`
);
ns = await shown();
check("a re-delivered PM does not double the count", ns.length === 1 && ns[0].count === 2, ns);

// 3. markdown off: markers stay, formatting bytes still go
await setMarkdown(false);
await clear();
await deliver(`@msgid=pm2${RUN};time=${T} :alice!u@h PRIVMSG me :\x02**hello**\x02`);
ns = await shown();
check("markdown off keeps the markers", ns[0]?.body === "**hello**", ns);

// 4. a three-line batch, out of order, markdown on: one notification, the fence stripped
await setMarkdown(true);
await clear();
const B = `b${RUN}`;
const ml = (i, text, concat = "") =>
	`@batch=${B};msgid=${B};time=${T};evilnet.github.io/line=${i}/3/3${concat} :bob!u@h PRIVMSG #seance :${text}`;
await deliver(ml(3, "```"));
await deliver(ml(1, "```js"));
await deliver(ml(2, "let x = 1;"));
ns = await shown();
check("one notification for the batch", ns.length === 1, ns);
check("batch counted once", ns[0]?.count === 1, ns);
check("batch body reassembled and stripped", ns[0]?.body === "bob: let x = 1;", ns);
check("batch title is a highlight", ns[0]?.title === "bob in #seance", ns);

// 5. a concat chunk glues on
await clear();
await deliver(
	`@batch=c${RUN};msgid=c${RUN};time=${T};evilnet.github.io/line=1/2/2 :bob!u@h PRIVMSG me :ab`
);
await deliver(
	`@batch=c${RUN};msgid=c${RUN};time=${T};evilnet.github.io/line=2/2/2;draft/multiline-concat :bob!u@h PRIVMSG me :cd`
);
ns = await shown();
check("concat joins without a separator", ns[0]?.body === "abcd", ns);

// 6. MARKREAD closes the target's notifications
await clear();
await deliver(`@msgid=r${RUN};time=${T} :carol!u@h PRIVMSG me :unread`);
await deliver(`:irc.example MARKREAD carol timestamp=2099-01-01T00:00:00.000Z`);
ns = await shown();
check("MARKREAD closed the conversation", ns.length === 0, ns);

// 7. the JSON tiers still work
await clear();
await deliver(
	JSON.stringify({
		t: "msg",
		from: "dave",
		target: "me",
		msgid: `j${RUN}`,
		time: T,
		text: "json tier",
	})
);
ns = await shown();
check("JSON full tier still renders", ns[0]?.body === "json tier", ns);

await call("Target.closeTarget", {targetId});
console.log(failures ? `\n${failures} failure(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
