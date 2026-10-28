// What the translation UI says this device can run, and why not, on the
// real device probe (capability.ts) over a stand-in for WebGPU: headless
// has no GPU, so an init script defines `navigator.gpu` (or takes it away)
// with an adapter that reports the features and limits of six devices:
//
//   noWebgpu  no `navigator.gpu` at all
//   noF16     an adapter without shader-f16
//   lowLimits shader-f16 and 2 GiB, but WebGPU's default 8 storage buffers
//             per shader stage, below WebLLM's floor of 10 (GPU_LIMITS)
//   binds128  shader-f16, 128 MiB in one storage binding (the tier is cpu)
//   binds160  160 MiB: the 1.7B fits, the 4B does not
//   desktop   2 GiB: everything runs
//
// For each, after a cold load with a fresh profile's storage: Settings →
// Translation's model rows say "Can run on this device" / "Can't run on this
// device" with the reason as its own line (the device code in words, or the
// buffer numbers), Download is disabled exactly where it cannot run and is
// described by that reason, and "In use" marks a GPU model only where one
// can run; the composer's translate dialog, opened on the
// same language twice (the cleanup pass, LLM-only), shows the confirm
// disabled with "Correcting a message needs the GPU model." and the reason
// where the GPU model cannot run, and "Correct" enabled where it can, and
// German as the target is on offer everywhere (the CPU models serve it);
// the channel panel greys the user's own language under "Send my messages
// in" with the same two sentences where the cleanup pass cannot run.
// Then, on the desktop device, the switches: the GPU model off makes its
// rows "Switched off above" and the cleanup pass say so; both off puts the
// panel's notice up ("Translation can't run here right now." and both
// switches named), disables the reading switch's On, dims the header button
// and makes its click open the panel, disables the message toolbar's
// Translate with the reason as its description, and disables German in the
// composer's dialog. On noWebgpu, the CPU models off is the one switch named.
//
// Not on the fake engine: ?fakeTranslate replaces the probe with its own
// answer. A production build is fine; no model is ever downloaded.
//
//   NODE_ENV=production corepack yarn build
//   python3 -m http.server -d public 8041 &
//   SEANCE_HTTP=http://localhost:8041/ CHROME_BIN=/seance/tmp/chrome-pw.sh \
//     node tools/browser-drive.mjs tools/scenarios/translate-capability.mjs
//   … --mobile --width=390 --height=844
//   … --device=binds128          (one device only)
//
// Needs the dev ircd's plain-WS port on 127.0.0.1:8067 (SEANCE_IRC_WS for
// the listener that posts the line the toolbar is checked on).

import {readFileSync} from "node:fs";

const RUN = Date.now().toString(36);
const BASE = process.env.SEANCE_HTTP || "http://localhost:8041/";
const IRCD = process.env.SEANCE_IRC_WS || "ws://127.0.0.1:8067/";
const CHANNEL = "#seance-capability";
const EN = JSON.parse(readFileSync("client/locales/en.json", "utf8"));
const MOBILE = process.argv.includes("--mobile");

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const SMALL = "Qwen3-1.7B-q4f16_1-MLC";
const LARGE = "Qwen3-4B-q4f16_1-MLC";
const NLLB = "Xenova/nllb-200-distilled-600M";
// models.ts LLM_CHOICES largestBufferBytes.
const NEEDS = {[SMALL]: 155_574_272, [LARGE]: 194_478_080};

const DEVICES = {
	noWebgpu: {
		gpu: null,
		runs: {[SMALL]: false, [LARGE]: false},
		why: () => EN["translate.why.noWebgpu"],
	},
	noF16: {
		gpu: {f16: false, max: 2 * GiB},
		runs: {[SMALL]: false, [LARGE]: false},
		why: () => EN["translate.why.noF16"],
	},
	lowLimits: {
		gpu: {f16: true, max: 2 * GiB, storageBuffers: 8},
		runs: {[SMALL]: false, [LARGE]: false},
		why: () => EN["translate.why.gpuLimits"],
	},
	binds128: {
		gpu: {f16: true, max: 128 * MiB},
		runs: {[SMALL]: false, [LARGE]: false},
		why: (id) => needsBuffer(NEEDS[id], 128 * MiB),
	},
	binds160: {
		gpu: {f16: true, max: 160 * MiB},
		runs: {[SMALL]: true, [LARGE]: false},
		why: (id) => needsBuffer(NEEDS[id], 160 * MiB),
	},
	desktop: {gpu: {f16: true, max: 2 * GiB}, runs: {[SMALL]: true, [LARGE]: true}, why: () => ""},
};

/** friendlysize.ts under the English locale. */
function size(bytes) {
	const units = ["Bytes", "KiB", "MiB", "GiB", "TiB"];
	const i = bytes > 0 ? Math.floor(Math.log(bytes) / Math.log(1024)) : 0;
	const n = new Intl.NumberFormat("en", {maximumFractionDigits: 1, useGrouping: false});

	return `${n.format(bytes / Math.pow(1024, i))} ${units[i]}`;
}

function needsBuffer(needed, limit) {
	return EN["translate.model.needsBuffer"]
		.replace("{needed}", size(needed))
		.replace("{limit}", size(limit));
}

// The stand-in, read from storage at every document start: the probe runs
// once per page, so each device is a cold load with its key set.
const GPU_STUB = `(() => {
	let device = null;
	try { device = JSON.parse(localStorage.getItem("seance.test.gpu") || "null"); } catch (e) {}
	if (!device) { return; }
	const gpu = device.gpu === null ? undefined : {
		requestAdapter: async () => ({
			features: new Set(device.gpu.f16 ? ["shader-f16"] : []),
			limits: {
				maxBufferSize: device.gpu.max,
				maxStorageBufferBindingSize: device.gpu.max,
				maxStorageBuffersPerShaderStage: device.gpu.storageBuffers ?? 10,
				maxComputeWorkgroupStorageSize: 32768,
			},
		}),
	};
	Object.defineProperty(Navigator.prototype, "gpu", {configurable: true, get: () => gpu});
})();`;

const ROW = (id) => `.translate-model[data-model=${JSON.stringify(id)}]`;
const text = (selector) =>
	`((document.querySelector(${JSON.stringify(selector)}) || {}).textContent || "").trim()`;
const GLOBE = "#chat button.translate";
const PICKER = ".source-language-picker";
const CONFIRM = `${PICKER} .source-language-picker-confirm`;

/** A second user who says one line in the channel, for the toolbar. */
function speaker(nick, line) {
	const ws = new WebSocket(IRCD, ["text.ircv3.net"]);

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("speaker never joined")), 20000);

		ws.onopen = () => {
			ws.send(`NICK ${nick}`);
			ws.send(`USER ${nick} 0 * :seance capability speaker`);
		};
		ws.onmessage = (ev) => {
			const msg = String(ev.data);

			if (msg.startsWith("PING")) {
				ws.send(msg.replace("PING", "PONG"));
			} else if (/ 001 /.test(msg)) {
				ws.send(`JOIN ${CHANNEL}`);
			} else if (new RegExp(`^(?:@\\S+ )?:${nick}\\S* JOIN`).test(msg)) {
				clearTimeout(timer);
				ws.send(`PRIVMSG ${CHANNEL} :${line}`);
				resolve({quit: () => ws.send("QUIT :done")});
			}
		};
		ws.onerror = () => reject(new Error("speaker socket error"));
	});
}

export default async function run(page) {
	await page.addInitScript(GPU_STUB);

	const only = page.opt("device", null);
	const names = only ? [only] : Object.keys(DEVICES);
	let first = true;

	const coldLoad = async (name, index) => {
		const nick = `cap${RUN}${index}`;
		const path = `/?host=127.0.0.1&port=8067&tls=false&nick=${nick}&join=${encodeURIComponent(
			CHANNEL
		)}`;
		const device = JSON.stringify({gpu: DEVICES[name].gpu});

		if (first) {
			first = false;
			await page.goto(new URL(path, BASE).href, {waitForSelector: "#app"});
			await page.evaluate(
				`(() => { localStorage.clear(); localStorage.setItem("seance.test.gpu", ${JSON.stringify(
					device
				)}); })()`
			);
		} else {
			await page.evaluate(
				`(() => { localStorage.clear(); localStorage.setItem("seance.test.gpu", ${JSON.stringify(
					device
				)}); })()`
			);
		}

		// F5 with the device's key set (browser-testing.md trap 8).
		await page.evaluate(
			`(() => { window.__coldLoad = true; history.replaceState(null, "", ${JSON.stringify(
				path
			)}); })()`
		);
		await page.send("Page.reload");
		const started = Date.now();

		for (;;) {
			try {
				if (
					await page.evaluate(
						`!window.__coldLoad && [...document.querySelectorAll("#chat .header .title")].some((el) => el.textContent.includes(${JSON.stringify(
							CHANNEL
						)}))`
					)
				) {
					break;
				}
				// A link to a server never approved asks first (link-approval.mjs).
				if (
					await page.evaluate(
						`!window.__coldLoad && !!document.querySelector("#connect .connect-link-notice")`
					)
				) {
					await page.click("#connect button[type=submit]");
					await page.sleep(500);
				}
			} catch {
				// the document is being replaced
			}

			if (Date.now() - started > 30000) {
				throw new Error(`${name}: never joined ${CHANNEL} after the cold load`);
			}

			await page.sleep(200);
		}
	};

	const openSettings = async () => {
		await page.evaluate(`location.hash = "#/settings/translation"`);
		await page.waitFor(`document.querySelectorAll(".translate-model").length >= 3`, {
			label: "model rows",
		});
		// The probe has answered once no row is still "checking".
		await page.waitFor(
			`![...document.querySelectorAll(".translate-model-runs")].some((el) => el.textContent.trim() === ${JSON.stringify(
				EN["translate.why.probing"]
			)})`,
			{label: "probe answered"}
		);
	};

	const closeSettings = async () => {
		await page.click(".settings-modal-done");
		await page.waitFor(`!document.querySelector(".settings-modal")`, {
			label: "settings closed",
		});
	};

	const setSwitch = async (name, on) => {
		const current = await page.evaluate(
			`document.querySelector('input[name="${name}"]').checked`
		);

		if (current !== on) {
			// A real click lands at the element's centre: bring it on screen first.
			await page.evaluate(
				`document.querySelector('input[name="${name}"]').scrollIntoView({block: "center"})`
			);
			await page.sleep(100);
			await page.click(`input[name="${name}"]`);
			await page.waitFor(
				`document.querySelector('input[name="${name}"]').checked === ${on}`,
				{label: `${name} ${on}`}
			);
		}
	};

	/** A finger on `selector` for `hold` ms: a tap, or a long press. */
	const finger = async (selector, hold) => {
		const r = await page.evaluate(
			`(() => { const b = document.querySelector(${JSON.stringify(
				selector
			)}).getBoundingClientRect(); return {x: b.x + Math.min(b.width / 2, 40), y: b.y + b.height / 2}; })()`
		);
		const points = [{x: r.x, y: r.y, radiusX: 12, radiusY: 12, force: 1}];

		await page.send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: points});
		await page.sleep(hold);
		await page.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
		await page.sleep(250);
	};

	const openPicker = async () => {
		await page.waitFor(`!!document.querySelector("#translate-once:not([disabled])")`, {
			label: "composer translate button enabled",
		});
		await page.click("#translate-once");
		await page.waitFor(`!!document.querySelector(${JSON.stringify(PICKER)})`, {
			label: "translate dialog open",
		});
	};

	const pickTarget = async (code) => {
		await page.evaluate(
			`(() => { const s = document.querySelector('${PICKER} select[name="translateInto"]'); s.value = ${JSON.stringify(
				code
			)}; s.dispatchEvent(new Event("change", {bubbles: true})); })()`
		);
		await page.sleep(100);
	};

	const pickerState = () =>
		page.evaluate(`(() => {
			const confirm = document.querySelector(${JSON.stringify(CONFIRM)});
			const hint = document.querySelector("${PICKER} .source-language-picker-hint");
			const described = confirm.getAttribute("aria-describedby");
			return {
				disabled: confirm.disabled,
				label: confirm.textContent.trim(),
				lead: ((hint && hint.querySelector(".source-language-picker-blocked")) || {}).textContent?.trim() || "",
				why: ((hint && hint.querySelector(".source-language-picker-why")) || {}).textContent?.trim() || "",
				hint: hint ? hint.textContent.trim() : "",
				describedOk: !described || document.getElementById(described) === hint,
				live: hint ? hint.getAttribute("aria-live") : null,
			};
		})()`);

	const closePicker = async () => {
		await page.click(`${PICKER} .source-language-picker-cancel`);
		await page.waitFor(`!document.querySelector(${JSON.stringify(PICKER)})`, {
			label: "dialog closed",
		});
	};

	const openPanel = async () => {
		const touch = await page.evaluate(
			`matchMedia("(hover: none) and (pointer: coarse)").matches`
		);

		if (touch) {
			await page.click(GLOBE);
		} else {
			await page.evaluate(
				`document.querySelector(${JSON.stringify(
					GLOBE
				)}).dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}))`
			);
		}

		await page.waitFor(`!!document.querySelector(".translation-panel")`, {label: "panel open"});
	};

	const closePanel = async () => {
		await page.click(".translation-panel-close");
		await page.waitFor(`!document.querySelector(".translation-panel")`, {
			label: "panel closed",
		});
	};

	const panelState = () =>
		page.evaluate(`(() => {
			const select = document.querySelector('.translation-panel select[name="translateWrite"]');
			const note = document.getElementById("translation-panel-write-note");
			const banner = document.getElementById("translation-panel-blocked");
			const on = [...document.querySelectorAll(".translation-panel-segment")].find((b) => b.getAttribute("aria-checked") === "false" && b.closest('[role="radiogroup"]') && b.parentElement.previousElementSibling);
			return {
				enDisabled: [...select.options].find((o) => o.value === "en").disabled,
				deDisabled: [...select.options].find((o) => o.value === "de").disabled,
				note: note ? note.textContent.replace(/\\s+/g, " ").trim() : "",
				noteDescribes: !note || select.getAttribute("aria-describedby") === note.id,
				banner: banner ? banner.textContent.replace(/\\s+/g, " ").trim() : "",
				bannerRole: banner ? banner.getAttribute("role") : null,
			};
		})()`);

	const readOnSegment = `[...document.querySelectorAll(".translation-panel-section")][0].querySelectorAll(".translation-panel-segment")[1]`;

	for (const [index, name] of names.entries()) {
		const device = DEVICES[name];

		if (!device) {
			throw new Error(`unknown --device=${name}`);
		}

		page.check(`--- ${name}`, true);
		await coldLoad(name, index);

		// 1. Settings → Translation: one verdict per row, the reason under it.
		await openSettings();

		for (const id of [SMALL, LARGE]) {
			const runs = device.runs[id];
			const state = await page.evaluate(`(() => {
				const row = document.querySelector(${JSON.stringify(ROW(id))});
				const button = row.querySelector(".translate-model-download");
				const described = button && button.getAttribute("aria-describedby");
				const named = button && button.getAttribute("aria-labelledby");
				return {
					name: named ? named.split(" ").map((id) => (document.getElementById(id) || {}).textContent?.replace(/\\s+/g, " ").trim()).join(" ") : "",
					modelName: row.querySelector(".translate-model-name > span:first-child").textContent.replace(/\\s+/g, " ").trim(),
					runs: row.dataset.runs,
					verdict: row.querySelector(".translate-model-runs").textContent.trim(),
					why: (row.querySelector(".translate-model-why") || {}).textContent?.trim() || "",
					disabled: button ? button.disabled : null,
					describedBy: described ? (document.getElementById(described) || {}).textContent?.trim() : "",
				};
			})()`);

			page.check(
				`${name}: ${id} says ${runs ? "it runs" : "it can't run"} (${state.verdict})`,
				state.runs === (runs ? "runs" : "cannot") &&
					state.verdict ===
						(runs ? EN["translate.model.runsHere"] : EN["translate.model.cantRun"])
			);
			page.check(
				`${name}: ${id}'s reason is "${device.why(id)}" (${state.why})`,
				state.why === (runs ? "" : device.why(id))
			);
			page.check(
				`${name}: ${id}'s Download is ${
					runs ? "enabled" : "disabled, described by the reason"
				}`,
				state.disabled === !runs && (runs || state.describedBy === state.why)
			);
			page.check(
				`${name}: ${id}'s Download is named for its model (${state.name})`,
				state.name === `${EN["translate.model.download"]} ${state.modelName}`
			);
		}

		// "In use" only on a GPU model that can run here.
		const inUse = await page.evaluate(
			`[...document.querySelectorAll(".translate-model-in-use")].map((el) => el.closest(".translate-model").dataset.model).join(",")`
		);
		const expectInUse = {binds160: SMALL}[name];

		page.check(
			`${name}: "In use" is on ${
				expectInUse ?? (device.runs[SMALL] ? "a GPU model" : "no row")
			} (${inUse || "none"})`,
			expectInUse
				? inUse === expectInUse
				: device.runs[SMALL]
				? inUse === SMALL || inUse === LARGE
				: inUse === ""
		);

		const nllb = await page.evaluate(
			`document.querySelector(${JSON.stringify(ROW(NLLB))}).dataset.runs`
		);

		page.check(`${name}: NLLB runs here (${nllb})`, nllb === "runs");
		await page.evaluate(
			`document.querySelector(".translate-models").scrollIntoView({block: "start"})`
		);
		await page.screenshot(`${name}-settings`);
		await closeSettings();

		// 2. The composer's dialog: what it opens on, the cleanup pass, German.
		await openPicker();

		const llm = device.runs[SMALL];
		const opened = await pickerState();
		const openedOn = await page.evaluate(
			`document.querySelector('${PICKER} select[name="translateInto"]').value`
		);

		// No earlier pick: the cleanup pass where the GPU model runs, else
		// the first language this device serves -- never a disabled dialog.
		page.check(
			`${name}: the dialog opens on ${
				llm ? "the cleanup pass" : "a pair that runs"
			} (${openedOn}, ${opened.disabled ? "disabled" : "enabled"})`,
			!opened.disabled && (llm ? openedOn === "en" : openedOn !== "en")
		);
		await page.screenshot(`${name}-composer-opened`, {selector: PICKER, pad: 8});
		await pickTarget("en");

		const same = await pickerState();

		page.check(`${name}: the dialog's hint is a polite live region`, same.live === "polite");

		if (llm) {
			page.check(
				`${name}: the cleanup pass is on offer ("${same.label}")`,
				!same.disabled &&
					same.label === EN["translate.picker.targetConfirmCorrect"] &&
					same.hint === EN["translate.picker.sameLanguage"]
			);
		} else {
			page.check(
				`${name}: the cleanup pass is disabled with its reason (${same.lead} / ${same.why})`,
				same.disabled &&
					same.lead === EN["translate.picker.sameLanguageNeedsGpu"] &&
					same.why === device.why(SMALL) &&
					same.describedOk
			);
		}

		await page.screenshot(`${name}-composer-same`, {selector: PICKER, pad: 8});
		await pickTarget("de");

		const german = await pickerState();

		page.check(
			`${name}: German is on offer (CPU models serve it)`,
			!german.disabled && german.lead === ""
		);
		await closePicker();

		// 3. The panel: the user's own language under "Send my messages in".
		await openPanel();

		const panel = await panelState();
		const focus = await page.evaluate(`(() => {
			const a = document.activeElement;
			return a ? {role: a.getAttribute("role"), checked: a.getAttribute("aria-checked"), text: a.textContent.trim()} : null;
		})()`);

		page.check(
			`${name}: the panel opens on the reading switch's checked choice (${JSON.stringify(
				focus
			)})`,
			!!focus && focus.role === "radio" && focus.checked === "true"
		);

		if (MOBILE) {
			// The sheet is modal: Tab and Shift+Tab stay inside it.
			const outside = [];

			for (let i = 0; i < 30; i++) {
				const shift = i >= 20;

				await page.send("Input.dispatchKeyEvent", {
					type: "rawKeyDown",
					key: "Tab",
					code: "Tab",
					windowsVirtualKeyCode: 9,
					modifiers: shift ? 8 : 0,
				});
				await page.send("Input.dispatchKeyEvent", {
					type: "keyUp",
					key: "Tab",
					code: "Tab",
					windowsVirtualKeyCode: 9,
					modifiers: shift ? 8 : 0,
				});

				const where = await page.evaluate(
					`(() => { const a = document.activeElement; return a && a.closest(".translation-panel") ? "" : (a ? a.tagName + "." + a.className : "none"); })()`
				);

				if (where) {
					outside.push(where);
				}
			}

			page.check(
				`${name}: Tab stays inside the sheet (${outside.join(", ") || "always inside"})`,
				outside.length === 0
			);
		}

		page.check(
			`${name}: no notice in the panel (something runs)`,
			panel.banner === "" && !panel.deDisabled
		);
		page.check(
			`${name}: the own language is ${llm ? "on offer" : "greyed, with the reason"} (${
				panel.note
			})`,
			llm
				? !panel.enDisabled && panel.note === ""
				: panel.enDisabled &&
						panel.note.includes(
							EN["translate.panel.ownLanguageNeedsGpu"].replace(
								"{language}",
								"English"
							)
						) &&
						panel.note.includes(device.why(SMALL)) &&
						panel.noteDescribes
		);
		await page.screenshot(`${name}-panel`);
		await closePanel();

		// 4. The switches.
		if (name === "noWebgpu") {
			await openSettings();
			await setSwitch("translateCpu", false);
			await closeSettings();
			await openPanel();

			const off = await panelState();

			page.check(
				`noWebgpu, CPU models off: the notice names the CPU switch (${off.banner})`,
				off.banner.includes(EN["translate.unavailable.lead"]) &&
					off.banner.includes(EN["translate.why.cpuOff"]) &&
					off.bannerRole === "status"
			);
			await page.screenshot("noWebgpu-cpu-off-panel");
			await closePanel();
		}

		if (name === "desktop") {
			await openSettings();
			await setSwitch("translateLlm", false);

			const rows = await page.evaluate(
				`[${JSON.stringify(SMALL)}, ${JSON.stringify(
					LARGE
				)}].map((id) => document.querySelector('.translate-model[data-model="' + id + '"] .translate-model-runs').textContent.trim())`
			);

			page.check(
				`desktop, GPU off: the GPU rows say switched off (${rows})`,
				rows.every((v) => v === EN["translate.model.switchedOff"])
			);
			await page.evaluate(
				`document.querySelector(".translate-models").scrollIntoView({block: "start"})`
			);
			await page.screenshot("desktop-gpu-off-settings");
			await closeSettings();
			await openPicker();

			// The GPU model off: the dialog no longer opens on the cleanup pass.
			const openedOff = await page.evaluate(
				`document.querySelector('${PICKER} select[name="translateInto"]').value`
			);

			page.check(
				`desktop, GPU off: the dialog opens on a pair that runs (${openedOff})`,
				openedOff !== "en" && !(await pickerState()).disabled
			);
			await pickTarget("en");

			const polish = await pickerState();

			page.check(
				`desktop, GPU off: the cleanup pass names the switch (${polish.why})`,
				polish.disabled &&
					polish.lead === EN["translate.picker.sameLanguageNeedsGpu"] &&
					polish.why === EN["translate.why.llmOff"]
			);
			await closePicker();

			// Both off: a line from someone else, for the toolbar.
			const other = await speaker(`cs${RUN}`, "Hallo zusammen, wie geht es euch heute?");

			await page.waitFor(
				`[...document.querySelectorAll("#chat .msg:not(.self)")].some((m) => m.textContent.includes("Hallo zusammen"))`,
				{label: "the speaker's line"}
			);
			await openSettings();
			await setSwitch("translateCpu", false);
			await closeSettings();

			const header = await page.evaluate(`(() => {
				const b = document.querySelector(${JSON.stringify(GLOBE)});
				return {unavailable: b.classList.contains("unavailable"), label: b.getAttribute("aria-label")};
			})()`);

			page.check(
				`desktop, both off: the header button is dimmed and says so (${header.label})`,
				header.unavailable && header.label === EN["translate.unavailable.lead"]
			);

			// Under --mobile the toolbar is a finger's: a long press opens it
			// and marks the last pointer a touch (helpers/inputModality.ts).
			if (MOBILE) {
				await page.evaluate(`(() => {
					const msg = [...document.querySelectorAll("#chat .msg:not(.self)")].reverse().find((m) => m.textContent.includes("Hallo zusammen"));
					msg.setAttribute("data-cap-target", "1");
				})()`);
				await finger("[data-cap-target] .content", 700);
			}

			const toolbar = await page.evaluate(`(() => {
				const msg = [...document.querySelectorAll("#chat .msg:not(.self)")].reverse().find((m) => m.textContent.includes("Hallo zusammen"));
				const b = msg && msg.querySelector(".msg-action-translate");
				const described = b && b.getAttribute("aria-describedby");
				return b ? {disabled: b.disabled, ariaDisabled: b.getAttribute("aria-disabled"), title: b.title, described: described ? (document.getElementById(described) || {}).textContent?.trim() : ""} : null;
			})()`);

			// Under a finger it stays tappable (aria-disabled) and the tap opens
			// the panel, since no tooltip shows there; under a mouse, disabled.
			page.check(
				`desktop, both off: the toolbar's Translate is ${
					MOBILE ? "aria-disabled" : "disabled"
				}, described by the reason (${JSON.stringify(toolbar)})`,
				!!toolbar &&
					(MOBILE
						? !toolbar.disabled && toolbar.ariaDisabled === "true"
						: toolbar.disabled) &&
					toolbar.described === EN["translate.why.allOff"] &&
					toolbar.title === EN["translate.why.allOff"]
			);

			if (!MOBILE) {
				await page.hover("#chat .msg:not(.self):last-of-type");
				await page.screenshot("desktop-both-off-toolbar", {
					selector: "#chat .msg:not(.self):last-of-type",
					pad: 40,
				});
			} else {
				// The tap a finger makes: the panel opens with the reason.
				await finger("[data-cap-target] .msg-action-translate", 60);
				await page.waitFor(`!!document.querySelector(".translation-panel")`, {
					label: "the toolbar's tap opened the panel",
				});

				const tapped = await panelState();

				page.check(
					`desktop, both off: the toolbar's tap opens the panel with the reason (${tapped.banner})`,
					tapped.banner.includes(EN["translate.why.allOff"])
				);
				await page.screenshot("desktop-both-off-toolbar-tap");
				await closePanel();
			}

			// The header's click opens the panel with the reason, not a reading that fails.
			await page.click(GLOBE);
			await page.waitFor(`!!document.querySelector(".translation-panel")`, {
				label: "the header's click opened the panel",
			});

			const off = await panelState();
			const onSegment = await page.evaluate(
				`(() => { const b = ${readOnSegment}; return {disabled: b.disabled, described: b.getAttribute("aria-describedby")}; })()`
			);
			const reading = await page.evaluate(
				`JSON.parse(localStorage.getItem("thelounge.translate") || "{}")`
			);

			page.check(
				`desktop, both off: the notice says both switches (${off.banner})`,
				off.banner.includes(EN["translate.unavailable.lead"]) &&
					off.banner.includes(EN["translate.why.allOff"])
			);
			page.check(
				`desktop, both off: reading's On is disabled and described by the notice`,
				onSegment.disabled && onSegment.described === "translation-panel-blocked"
			);
			page.check(
				`desktop, both off: the click did not switch reading on`,
				!JSON.stringify(reading).includes('"read":true')
			);
			page.check(
				`desktop, both off: every language is greyed under "Send my messages in"`,
				off.enDisabled && off.deDisabled
			);
			await page.screenshot("desktop-both-off-panel");
			await closePanel();

			await openPicker();
			await pickTarget("de");

			const blocked = await pickerState();

			page.check(
				`desktop, both off: German in the dialog is disabled with the reason (${blocked.lead} / ${blocked.why})`,
				blocked.disabled &&
					blocked.lead ===
						EN["translate.pair.unavailable"]
							.replace("{from}", "English")
							.replace("{to}", "German") &&
					blocked.why === EN["translate.why.allOff"]
			);
			await page.screenshot("desktop-both-off-composer", {selector: PICKER, pad: 8});
			await closePicker();
			other.quit();
		}
	}

	page.check(
		`no console errors (${page.consoleErrors.map((e) => e.text).join(" | ")})`,
		page.consoleErrors.length === 0
	);
}
