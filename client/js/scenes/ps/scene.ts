/**
 * The ps theme's scene (docs/projects/ps-theme.md §3, §5): the plains behind
 * the whole app. Mounted into #theme-scene by the theme-scene hook
 * (client/js/themeScene.ts). It builds its elements once, then once a minute
 * (and whenever the page becomes visible) writes the engine's and the
 * palette's answer as custom properties on its root, and publishes on <html>
 * the four values the chrome reads, and the hour's sky as the browser's
 * `theme-color`. It keeps the yurt in the message column's far third
 * (placeYurt). All motion is CSS or SVG animation; no script runs per frame.
 * A hidden page's scene is stopped outright. No Vue, no store; the markup
 * below (and plains.ts's land, near grass, fireflies, yurt and smoke) is
 * constant, and nothing user-supplied is ever written into it.
 */
import {isPhoneLayout} from "../../helpers/device";
import type {SceneHandle, SceneHostState} from "../../themeScene";
import {momentAt, rng, type Moment, type MoonPhase} from "./engine";
import {levelsAt, paletteAt, publishedFor, WEATHER, type Palette, type Published} from "./palette";
import {FIREFLIES, fireflies, landSvg, nearGrass, smoke, yurtSvg} from "./plains";
import {yurtFollower} from "./yurt";

const STAR_COUNT = 190;
const RAD = Math.PI / 180;

/** Everything the scene's CSS reads, as custom properties on #theme-scene. */
export function sceneVars(m: Moment, p: Palette): Record<string, string> {
	const wx = WEATHER[m.weather];
	const heat = 1 - Math.max(0, m.sun.alt);
	const glowX = m.sun.up ? Math.min(92, Math.max(8, m.sun.x)) : m.minute < 720 ? 10 : 90;
	const moonOpacity =
		m.moon.up && m.phase.present ? Math.min(1, p.dark * 1.25) * (1 - wx.hide * 0.85) : 0;
	const l = levelsAt(m, p);
	return {
		"--ps-sky-top": p.skyTop,
		"--ps-sky-mid": p.skyMid,
		"--ps-sky-hor": p.skyHorizon,
		"--ps-stars": p.stars.toFixed(3),
		"--ps-milky": p.milky.toFixed(3),
		"--ps-glow": p.glow,
		"--ps-glow-op": p.glowOpacity.toFixed(3),
		"--ps-glow-x": `${glowX.toFixed(2)}%`,
		"--ps-sun-x": `${m.sun.x.toFixed(2)}%`,
		"--ps-sun-y": `${m.sun.y.toFixed(2)}%`,
		"--ps-sun-scale": (1 + 0.45 * heat).toFixed(3),
		"--ps-sun-op": m.sun.up ? (1 - wx.hide).toFixed(2) : "0",
		"--ps-sun-mid": p.sunMid,
		"--ps-sun-edge": p.sunEdge,
		"--ps-sun-flame": p.sunFlame,
		"--ps-sun-bloom": p.sunBloom,
		"--ps-moon-x": `${m.moon.x.toFixed(2)}%`,
		"--ps-moon-y": `${m.moon.y.toFixed(2)}%`,
		"--ps-moon-op": moonOpacity.toFixed(3),
		// The land bands (Palette already carries these; plan 1 never published them).
		"--ps-mount": p.mount,
		"--ps-far": p.far,
		"--ps-hill2": p.hill2,
		"--ps-hill1": p.hill1,
		"--ps-grass": p.grass,
		"--ps-blade": p.blade,
		"--ps-felt": p.felt,
		"--ps-band": p.band,
		"--ps-door": p.door,
		"--ps-cloud": p.cloud,
		"--ps-cloud-under": p.cloudUnder,
		// The derived land and yurt colours (plan 3, palette.ts's mixOklab recipes).
		"--ps-mount2": p.mount2,
		"--ps-tree": p.tree,
		"--ps-trunk": p.trunk,
		"--ps-shrub": p.shrub,
		"--ps-tuft2": p.tuft2,
		"--ps-tuft1": p.tuft1,
		"--ps-tuft-lit": p.tuftLit,
		"--ps-riverbed": p.riverbed,
		"--ps-bedstone": p.bedstone,
		"--ps-river-hi": p.riverHi,
		"--ps-river-sky-top": p.riverSkyTop,
		"--ps-river-sky-bottom": p.riverSkyBottom,
		"--ps-felt-shade": p.feltShade,
		"--ps-roof-top": p.roofTop,
		"--ps-roof-bottom": p.roofBottom,
		"--ps-roof-stroke": p.roofStroke,
		"--ps-band-mark": p.bandMark,
		"--ps-rope": p.rope,
		"--ps-rib": p.rib,
		"--ps-door-orn": p.doorOrn,
		"--ps-crown": p.crown,
		"--ps-pipe": p.pipe,
		"--ps-stone": p.stone,
		"--ps-wood": p.wood,
		"--ps-path": p.path,
		// The day's levels.
		"--ps-water": l.water.toFixed(2),
		"--ps-flowers": l.flowers.toFixed(2),
		"--ps-snowcap": l.snowcap.toFixed(2),
		"--ps-ff-op": l.fireflies.toFixed(2),
		"--ps-skeins-op": l.skeins.toFixed(2),
		"--ps-residents-op": l.residents.toFixed(2),
		"--ps-wind-op": l.wind.toFixed(2),
		"--ps-sway": `${l.sway}deg`,
		"--ps-heat-op": l.heat.toFixed(2),
		"--ps-veil": l.veil.toFixed(2),
		"--ps-veil-c": l.veilColour,
		"--ps-tuft-lit-op": l.tuftLit.toFixed(2),
		"--ps-bird-ink": l.birdInk,
		"--ps-night-glow": p.nightGlow.toFixed(3),
		"--ps-smoke-op": p.smokeOpacity.toFixed(3),
		"--ps-smoke": p.smoke,
		"--ps-dark": p.dark.toFixed(3),
	};
}

/**
 * The browser's chrome colour (`<meta name="theme-color">`) for the hour: the
 * sky-top the scene publishes as the page canvas, so the browser's bar runs
 * on into the sky under it (docs/projects/ps-theme.md §6).
 */
export function themeColorFor(published: Published): string {
	return published.canvas;
}

/**
 * The moon's lit shape (heart-theme.md §11.2b): a dark disc, the near half lit,
 * then one ellipse of horizontal radius R·|cos D|, dark for a crescent and lit
 * for a gibbous, the whole mirrored when waning. R is 30 in the moon's viewBox.
 */
export function moonShape(phase: MoonPhase): {rx: number; fill: "#000" | "#fff"; mirror: boolean} {
	const f = phase.waning ? 360 - phase.elongation : phase.elongation;
	return {
		rx: Math.abs(30 * Math.cos(f * RAD)),
		fill: f < 90 ? "#000" : "#fff",
		mirror: phase.waning,
	};
}

/* The mockup's moon and sun, ids prefixed so nothing else on the page can collide. */
const MOON = `<div class="ps-moon"><svg viewBox="-60 -60 120 120">
<defs>
<radialGradient id="ps-m-halo"><stop offset="0" stop-color="#e3e9ff" stop-opacity=".42"/><stop offset=".55" stop-color="#c7d2ff" stop-opacity=".12"/><stop offset="1" stop-color="#c7d2ff" stop-opacity="0"/></radialGradient>
<radialGradient id="ps-m-disc" cx=".42" cy=".4" r=".7"><stop offset="0" stop-color="#fdfaf0"/><stop offset=".62" stop-color="#ece5cf"/><stop offset="1" stop-color="#c9c0a6"/></radialGradient>
<filter id="ps-m-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.3"/></filter>
<mask id="ps-m-phase" maskUnits="userSpaceOnUse" x="-60" y="-60" width="120" height="120">
<rect x="-60" y="-60" width="120" height="120" fill="#000"/>
<g class="ps-m-shape"><path d="M0,-30 A30,30 0 0 1 0,30 Z" fill="#fff"/><ellipse class="ps-m-ell" rx="0" ry="30" fill="#000"/></g>
</mask>
</defs>
<circle r="60" fill="url(#ps-m-halo)"/>
<circle r="30" fill="#39426a" opacity=".32"/>
<g mask="url(#ps-m-phase)">
<circle r="30" fill="url(#ps-m-disc)"/>
<g filter="url(#ps-m-soft)" fill="#8f8c82" opacity=".5"><ellipse cx="-9" cy="-11" rx="9" ry="7"/><ellipse cx="3" cy="-12" rx="6" ry="5"/><ellipse cx="7" cy="-2" rx="7" ry="6"/><ellipse cx="14" cy="6" rx="4.5" ry="6"/><ellipse cx="-15" cy="3" rx="7" ry="10"/><ellipse cx="-4" cy="10" rx="5" ry="4"/></g>
<g fill="none" stroke="#b6af9c" stroke-width=".7" opacity=".7"><circle cx="-4" cy="21" r="2.4"/><circle cx="17" cy="-15" r="1.8"/><circle cx="-20" cy="-14" r="1.5"/><circle cx="10" cy="18" r="1.4"/><circle cx="21" cy="10" r="1.2"/></g>
<path d="M-4,21 L-11,28 M-4,21 L4,27 M-4,21 L-4,12 M-4,21 L-14,17 M-4,21 L6,16" stroke="#f4efdf" stroke-width=".5" opacity=".35"/>
</g>
</svg></div>`;

const SUN = `<div class="ps-sun"><div class="ps-rays"></div><svg viewBox="-100 -100 200 200">
<defs>
<radialGradient id="ps-s-bloom"><stop offset="0" style="stop-color: var(--ps-sun-bloom)" stop-opacity=".95"/><stop offset=".5" style="stop-color: var(--ps-sun-bloom)" stop-opacity=".25"/><stop offset="1" style="stop-color: var(--ps-sun-bloom)" stop-opacity="0"/></radialGradient>
<radialGradient id="ps-s-flame"><stop offset="0" style="stop-color: var(--ps-sun-flame)"/><stop offset=".6" style="stop-color: var(--ps-sun-flame)" stop-opacity=".8"/><stop offset="1" style="stop-color: var(--ps-sun-edge)" stop-opacity="0"/></radialGradient>
<radialGradient id="ps-s-core" cx=".45" cy=".42" r=".62"><stop offset="0" stop-color="#fffef6"/><stop offset=".38" stop-color="#fff3c2"/><stop offset=".78" style="stop-color: var(--ps-sun-mid)"/><stop offset="1" style="stop-color: var(--ps-sun-edge)"/></radialGradient>
<filter id="ps-s-fire" x="-60%" y="-60%" width="220%" height="220%">
<feTurbulence type="fractalNoise" baseFrequency="0.034 0.052" numOctaves="3" seed="7" result="n"><animate attributeName="baseFrequency" dur="7s" repeatCount="indefinite" values="0.034 0.052;0.046 0.036;0.03 0.06;0.034 0.052"/></feTurbulence>
<feDisplacementMap in="SourceGraphic" in2="n" scale="26" xChannelSelector="R" yChannelSelector="G"/>
<feGaussianBlur stdDeviation="1.2"/>
</filter>
</defs>
<circle r="98" fill="url(#ps-s-bloom)"/>
<g filter="url(#ps-s-fire)"><circle r="56" fill="url(#ps-s-flame)"/></g>
<circle r="37" fill="url(#ps-s-core)"/>
</svg></div>`;

function stars(): string {
	const r = rng(90210);
	let out = "";

	for (let i = 0; i < STAR_COUNT; i++) {
		const big = r() > 0.9;
		const twinkle = r() > 0.72;
		const cls = [big ? "b" : "", twinkle ? "tw" : ""].filter(Boolean).join(" ");
		out +=
			`<i class="${cls}" style="left:${(r() * 100).toFixed(2)}%;top:${(r() * 100).toFixed(
				2
			)}%;` +
			`opacity:${(0.35 + r() * 0.65).toFixed(2)};--tw:${(2.5 + r() * 4).toFixed(1)}s"></i>`;
	}

	return out;
}

/**
 * The scene's layers, back to front (docs/projects/ps-theme.md §5.1): the sky
 * is the root's own background; then the Milky Way, the stars, the horizon
 * glow, the moon and the sun; the ground group — the land and river, the
 * fireflies, the yurt and its smoke, the animal layer (switched off in
 * ps.css) — which the heat haze bends as one; and the near grass in front of
 * it, outside the haze. A phone (the phone layout at mount) gets half the
 * fireflies.
 */
export function sceneMarkup(phone: boolean): string {
	return (
		`<div class="ps-milky"></div><div class="ps-stars">${stars()}</div><div class="ps-glow"></div>` +
		MOON +
		SUN +
		`<div class="ps-ground">` +
		landSvg() +
		`<div class="ps-fireflies">${fireflies(phone ? FIREFLIES / 2 : FIREFLIES)}</div>` +
		`<div class="ps-yurt">${yurtSvg()}</div>` +
		`<div class="ps-smoke">${smoke()}</div>` +
		`<div class="ps-animals"></div>` +
		`</div>` +
		nearGrass()
	);
}

/**
 * Keeps the yurt in the message column's far third (yurt.ts, spec §5.3). It
 * observes `#chat .chat` — MessageList.vue's scroll container; not `#chat`,
 * which holds the user list too — and hands each measurement to the
 * follow-or-fade rule, which writes `--ps-yurt-left` on the root and toggles
 * `ps-yurt-moving`. A conversation switch can replace the column, so it is
 * looked for again on every host update and whenever the one observed leaves
 * the page; with no column on screen (Settings, Help, the connect form) the
 * yurt keeps its place.
 */
function placeYurt(root: HTMLElement): {refind(): void; destroy(): void} {
	const follower = yurtFollower({
		place: (px) => root.style.setProperty("--ps-yurt-left", `${Math.round(px)}px`),
		hide: (on) => root.classList.toggle("ps-yurt-moving", on),
		after(ms, fn) {
			const id = window.setTimeout(fn, ms);
			return () => window.clearTimeout(id);
		},
		nextFrame(fn) {
			const id = window.requestAnimationFrame(fn);
			return () => window.cancelAnimationFrame(id);
		},
	});
	let column: Element | null = null;
	let frame: number | undefined;

	const measure = () => {
		const scene = root.getBoundingClientRect();
		const box = column?.isConnected ? column.getBoundingClientRect() : null;
		const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		follower.measure(
			box && box.width > 0 ? {left: box.left - scene.left, width: box.width} : null,
			scene.width,
			rem
		);
	};

	const observer = new ResizeObserver(() => {
		if (column?.isConnected) {
			measure();
		} else {
			findSoon(); // it left the page; its replacement, if any, is there by the next frame
		}
	});

	function find() {
		const found = document.querySelector("#chat .chat");

		if (found === column) {
			return;
		}

		if (column) {
			observer.unobserve(column);
		}

		column = found;

		if (column) {
			observer.observe(column); // its first observation measures it
		}
	}

	// Also on the next frame: the host's update comes before Vue has patched
	// the page, and a ResizeObserver callback must not start observing itself.
	function findSoon() {
		if (frame === undefined) {
			frame = window.requestAnimationFrame(() => {
				frame = undefined;
				find();
			});
		}
	}

	return {
		refind() {
			find();
			findSoon();
		},
		destroy() {
			observer.disconnect();
			follower.stop();

			if (frame !== undefined) {
				window.cancelAnimationFrame(frame);
				frame = undefined;
			}

			root.classList.remove("ps-yurt-moving");
		},
	};
}

export function mount(root: HTMLElement, initial: SceneHostState): SceneHandle {
	const html = document.documentElement;
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
	root.innerHTML = sceneMarkup(isPhoneLayout());
	const ellipse = root.querySelector(".ps-m-ell") as SVGEllipseElement;
	const shape = root.querySelector(".ps-m-shape") as SVGGElement;
	// The theme's own theme-color, kept to hand back on destroy; and the last
	// colour the scene wrote, so a destroy after something else has written the
	// tag (the next theme's colour, the deploy's) leaves that alone.
	const meta = document.querySelector('meta[name="theme-color"]');
	const themeColor = meta instanceof HTMLMetaElement ? meta.content : null;
	let wrote: string | null = null;
	let timer: number | undefined;
	let visible = false;

	const apply = (now: Date) => {
		const m = momentAt(now);
		const p = paletteAt(m);

		for (const [name, value] of Object.entries(sceneVars(m, p))) {
			root.style.setProperty(name, value);
		}

		const lit = moonShape(m.phase);
		ellipse.setAttribute("rx", lit.rx.toFixed(2));
		ellipse.setAttribute("fill", lit.fill);
		shape.setAttribute("transform", lit.mirror ? "scale(-1,1)" : "");
		root.dataset.weather = m.weather;
		root.dataset.season = m.season.main;
		const out = publishedFor(p);
		html.dataset.psLight = out.light;
		html.dataset.psText = out.text;
		html.style.setProperty("--ps-halo", out.halo);
		html.style.setProperty("--canvas-bg-color", out.canvas);

		if (meta instanceof HTMLMetaElement) {
			wrote = themeColorFor(out);
			meta.content = wrote;
		}
	};

	// Once now, then on each minute boundary.
	const tick = () => {
		const now = new Date();
		apply(now);
		timer = window.setTimeout(
			tick,
			60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 20
		);
	};

	const motion = (run: boolean) => {
		root.classList.toggle("ps-paused", !run);

		for (const svg of root.querySelectorAll("svg")) {
			if (run) {
				svg.unpauseAnimations();
			} else {
				svg.pauseAnimations();
			}
		}
	};

	const onReduced = () => motion(visible && !reduced.matches);
	reduced.addEventListener("change", onReduced);
	const yurt = placeYurt(root);

	const update = (state: SceneHostState) => {
		root.dataset.view = state.view;
		yurt.refind();

		if (state.visible && !visible) {
			visible = true;
			motion(!reduced.matches);
			tick(); // catch up at once: a laptop that slept shows the right sky
		} else if (!state.visible && visible) {
			visible = false;
			window.clearTimeout(timer);
			timer = undefined;
			motion(false);
		}
	};

	// A scene mounted into a hidden page starts stopped; the first visible update starts it.
	motion(false);
	update(initial);

	return {
		update,
		destroy() {
			window.clearTimeout(timer);
			timer = undefined;
			reduced.removeEventListener("change", onReduced);
			yurt.destroy();
			root.replaceChildren();
			root.removeAttribute("style");
			root.classList.remove("ps-paused");
			delete root.dataset.view;
			delete root.dataset.weather;
			delete root.dataset.season;
			delete html.dataset.psLight;
			delete html.dataset.psText;
			html.style.removeProperty("--ps-halo");
			html.style.removeProperty("--canvas-bg-color");

			if (meta instanceof HTMLMetaElement && themeColor !== null && meta.content === wrote) {
				meta.content = themeColor;
			}
		},
	};
}
