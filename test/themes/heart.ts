import {expect} from "chai";
import fs from "fs";
import path from "path";
import bird from "../../tools/heart/rigs/bird.mjs";
import bunny from "../../tools/heart/rigs/bunny.mjs";
import deer from "../../tools/heart/rigs/deer.mjs";
import frog from "../../tools/heart/rigs/frog.mjs";
import horse from "../../tools/heart/rigs/horse.mjs";
import kitten from "../../tools/heart/rigs/kitten.mjs";
import ladybug from "../../tools/heart/rigs/ladybug.mjs";
import puppy from "../../tools/heart/rigs/puppy.mjs";

const css = fs.readFileSync(path.resolve(__dirname, "../../client/themes/heart.css"), "utf8");

describe("the <3 theme (client/themes/heart.css)", function () {
	it("is coffee's rules with its own tokens", function () {
		expect(css.startsWith("/*")).to.be.true;
		expect(css).to.include('@import "coffee.css";');
		expect(css).to.include("color-scheme: light;");
		expect(css).to.include("--chat-bg: #dbeeff;");
	});
});

/** WCAG relative luminance of a #rrggbb. */
function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (l1 + 0.05) / (l2 + 0.05);
}

describe("the <3 theme's colours", function () {
	const SKY = "#dbeeff";
	const BLUSH = "#ffd6e6";

	it("sets every token coffee.css reads", function () {
		for (const token of [
			"--chat-fg",
			"--chat-fg-muted",
			"--chat-fg-faint",
			"--chat-heading",
			"--chat-rule",
			"--chat-accent",
			"--chat-accent-fg",
			"--chat-accent-rule",
			"--chat-highlight-bg",
			"--chat-selection",
			"--composer-bg",
			"--composer-border",
			"--window-border",
			"--window-shadow",
			"--menu-bg",
			"--rail-bg-top",
			"--rail-bg-bottom",
			"--rail-fg",
			"--rail-fg-strong",
			"--rail-fg-active",
			"--rail-fg-muted",
			"--rail-item-active-bg",
			"--rail-item-hover-bg",
			"--rail-accent",
			"--rail-accent-fg",
			"--rail-badge-bg",
			"--rail-badge-fg",
			"--rail-input-bg",
			"--rail-input-border",
			"--event-join",
			"--event-quit",
			"--nick-default",
			"--notice-color",
			"--action-color",
			"--note-bg",
			"--note-fg",
			"--warn-bg",
			"--warn-fg",
			"--error-bg",
			"--error-fg",
			"--ok-bg",
			"--ok-fg",
			"--tint-soft",
			"--tint-strong",
			"--accent-tint-20",
			"--accent-tint-30",
			"--focus-ring",
			"--scrollbar-track",
			"--scrollbar-thumb",
			"--scrollbar-thumb-active",
			"--tok-comment",
			"--tok-keyword",
			"--tok-string",
			"--tok-number",
			"--tok-function",
			"--tok-operator",
			"--tok-punctuation",
			"--tok-tag",
			"--tok-attr",
		]) {
			expect(css, token).to.match(new RegExp(`^\\s*${token}:`, "m"));
		}
	});

	/** A token's #rrggbb or #rgb value, the latter expanded to 6 digits. */
	const value = (token: string) => {
		const hex = css.match(
			new RegExp(`^\\s*${token}:\\s*(#[0-9a-f]{6}|#[0-9a-f]{3});`, "m")
		)![1];
		return hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
	};

	it("keeps text at 4.5:1 on the sky and on a highlighted row", function () {
		for (const token of [
			"--chat-fg",
			"--chat-fg-muted",
			"--chat-accent",
			"--event-join",
			"--nick-default",
			"--action-color",
			"--notice-color",
		]) {
			expect(contrast(value(token), SKY), `${token} on sky`).to.be.at.least(4.5);
		}

		expect(contrast(value("--chat-fg"), BLUSH), "text on blush").to.be.at.least(4.5);
	});

	it("keeps icons and placeholders (the one deliberate exception) at 3:1 on the sky", function () {
		expect(contrast(value("--chat-fg-faint"), SKY), "--chat-fg-faint on sky").to.be.at.least(
			3.0
		);
	});

	it("keeps the unread badge's text at 4.5:1 on its own background", function () {
		expect(
			contrast(value("--rail-badge-fg"), value("--rail-badge-bg")),
			"--rail-badge-fg on --rail-badge-bg"
		).to.be.at.least(4.5);
	});

	it("carries 32 nick colours that read on the sky and on a highlighted row", function () {
		const slots = [...css.matchAll(/^\.user\.color-(\d+) \{ color: (#[0-9a-f]{6}); \}/gm)];
		expect(slots.map((m) => Number(m[1]))).to.deep.equal(
			Array.from({length: 32}, (_, i) => i + 1)
		);

		for (const [, n, hex] of slots) {
			expect(contrast(hex, SKY), `color-${n} on sky`).to.be.at.least(4.5);
			expect(contrast(hex, BLUSH), `color-${n} on blush`).to.be.at.least(4.5);
		}
	});
});

describe("the <3 theme's type", function () {
	it("bundles Nunito and Baloo 2 as variable fonts and sets them at the chosen weights", function () {
		for (const file of [
			"heart/nunito-variable.woff2",
			"heart/nunito-variable-italic.woff2",
			"heart/baloo2-variable.woff2",
		]) {
			expect(css).to.include(`url("${file}")`);
		}

		expect(css, "weight ranges").to.match(
			/font-family: Nunito;\s*font-style: normal;\s*font-weight: 400 800;/
		);
		expect(css, "italic range").to.match(/font-style: italic;\s*font-weight: 400 700;/);
		expect(css, "Baloo range").to.match(
			/font-family: "Baloo 2";\s*font-style: normal;\s*font-weight: 400 800;/
		);
		expect(css).to.match(/#chat \.msg \.user[\s\S]{0,160}font-family:\s*"Baloo 2"/);
		expect(css, "no rule between nick and text").to.match(
			/#chat \.content \{\s*border-left-color: transparent;/
		);
		expect(css, "the header is paper like the composer").to.match(
			/#chat \.header \{\s*background: var\(--heart-paper\);/
		);
		expect(css).to.match(
			/body,[\s\S]{0,200}font-family:\s*Nunito[\s\S]{0,80}font-weight:\s*600/
		);
	});

	it("widens the 12h timestamp column past a 4.5rem/5.75rem wrap under Nunito", function () {
		const typeSection = css.slice(
			css.indexOf("/* ---- type ---- */"),
			css.indexOf("/* ---- motion ---- */")
		);
		expect(typeSection).to.match(/#chat\.time-12h \.time \{\s*width: 5\.5rem;/);
		expect(typeSection).to.match(/#chat\.time-seconds\.time-12h \.time \{\s*width: 7\.25rem;/);
		expect(typeSection).to.not.match(/font-variant-numeric:\s*tabular-nums/);
	});
});

describe("the <3 theme's motion", function () {
	it("fades messages in, raises the chrome, glows a mention, and stands down under reduced motion", function () {
		expect(css).to.include("@keyframes heart-fade");
		expect(css).to.match(/#chat \.msg \{[^}]*animation: heart-fade 340ms ease-out backwards/);
		expect(css).to.match(/#chat \.msg\.pending \{[^}]*animation-name: none/);
		expect(css).to.include("@keyframes heart-rise");
		expect(css).to.include("@keyframes heart-glow");
		expect(css).to.match(
			/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation: none !important/
		);
	});
});

describe("the <3 theme's glitter", function () {
	it("has four bursts, cycled on send, and fires on reactions; nothing on hover", function () {
		for (const n of [1, 2, 3, 4]) {
			expect(css).to.include(`--heart-burst-${n}:`);
		}

		for (const n of [1, 2, 3, 4]) {
			expect(css).to.match(
				new RegExp(`\\.msg\\.self:last-child:nth-child\\(4n\\s*\\+\\s*${n}\\)::before`)
			);
		}

		expect(css, "no hover glitter").to.not.include(":hover::");
		expect(css, "the send burst hangs off the text column").to.match(
			/#chat \.msg\.self:last-child::before,\s*#chat \.msg\.self:last-child::after \{[^}]*left: calc\(var\(--heart-text-x\) - 0\.4em\)/
		);

		for (const [cls, x] of [
			["", "13.25rem"],
			[".time-seconds", "14.5rem"],
			[".time-12h", "15.25rem"],
			[".time-seconds.time-12h", "17rem"],
		]) {
			expect(css, `text start with ${cls || "the default clock"}`).to.match(
				new RegExp(`#chat${cls.replace(/\./g, "\\.")} \\{\\s*--heart-text-x: ${x};`)
			);
		}

		expect(css).to.match(/@media \(max-width: 479px\) \{\s*#chat \{\s*--heart-text-x: 0\.4em;/);
		expect(css).to.include(".reaction-enter-active::before");
		expect(css, "the first reaction's group bursts too").to.include(
			".reactions-enter-active .msg-reaction:not(.msg-reaction-add)::before"
		);
		expect(css, "the enter class is held open for the burst").to.match(
			/#chat \.reaction-enter-active,\s*#chat \.reactions-enter-active \{[^}]*heart-hold 0\.9s/
		);
	});

	it("does not burst .msg-reaction.self on its own, a persistent class that would burst on every redraw", function () {
		const glitterSection = css.slice(
			css.indexOf("/* ---- glitter ---- */"),
			css.indexOf("/* ---- meadow ---- */")
		);
		expect(glitterSection).to.not.include(".msg-reaction.self::");
	});

	it("leaves burst sizing to the burst variables, not a stretching background-size", function () {
		const glitterSection = css.slice(
			css.indexOf("/* ---- glitter ---- */"),
			css.indexOf("/* ---- meadow ---- */")
		);
		expect(glitterSection).to.not.include("background-size");
	});
});

describe("the <3 theme's meadow", function () {
	it("paints sky, hills and clouds behind channels and queries, seeded per conversation", function () {
		expect(css).to.match(
			/#chat \.chat-view\[data-type="channel"\] \.chat,\s*#chat \.chat-view\[data-type="query"\] \.chat \{/
		);
		expect(css).to.include("var(--channel-seed, 0.5)");

		for (const n of [0, 1, 2, 3, 4, 5]) {
			expect(css).to.include(`#chat-container[data-scene="${n}"]`);
		}

		const scene1Start = css.indexOf('#chat-container[data-scene="1"]');
		const scene1Body = css.slice(scene1Start, css.indexOf("}", scene1Start));
		expect(scene1Body, "scene 1 hides the second cloud").to.include("--heart-cloud-2");

		expect(css).to.include("@keyframes heart-clouds");
		expect(css, "the meadow never pauses while typing").to.not.include(
			"animation-play-state: paused"
		);
		expect(css).to.match(/@media \(max-width: 600px\)[\s\S]*--strip: 6\.5rem/);
		expect(css).to.match(/text-shadow: 0 0 6px var\(--heart-sky\)/);
		expect(css, "spoilers keep no halo").to.match(
			/\.md-spoiler:not\(\.md-spoiler-shown\) \{[^}]*text-shadow: none/
		);
	});

	it("computes the seeded hue on #chat-container, not on :root, so the tint actually varies", function () {
		const meadowSection = css.slice(css.indexOf("/* ---- meadow ---- */"));

		const bareStart = meadowSection.indexOf("#chat-container {");
		expect(bareStart, "a bare #chat-container rule").to.be.greaterThan(-1);
		const bodyStart = meadowSection.indexOf("{", bareStart) + 1;
		const bodyEnd = meadowSection.indexOf("}", bodyStart);
		const chatContainerRule = meadowSection.slice(bodyStart, bodyEnd);

		expect(chatContainerRule).to.include("--heart-hill-hue:");
		expect(chatContainerRule).to.include("var(--channel-seed, 0.5)");

		for (const match of meadowSection.matchAll(/:root\s*\{([^}]*)\}/g)) {
			expect(match[1]).to.not.include("--heart-hill-hue:");
		}
	});

	it("keeps the clouds on screen, just still, under reduced motion", function () {
		const reducedMotionBlock = css.slice(
			css.indexOf("@media (prefers-reduced-motion: reduce)")
		);

		expect(reducedMotionBlock).to.include("background-position");
		expect(reducedMotionBlock).to.include("22%");
		expect(reducedMotionBlock).to.include("68%");
	});
});

describe("the <3 theme's animals", function () {
	/** The cast (tools/heart/README.md); the teddy and the dolphin are held. */
	const CAST = ["horse", "deer", "puppy", "bunny", "kitten", "frog", "ladybug", "bird"];

	/** One scene rule's body. */
	const sceneBody = (n: number) => {
		const start = css.indexOf(`#chat-container[data-scene="${n}"]`);
		expect(start, `scene ${n}`).to.be.greaterThan(-1);
		return css.slice(start, css.indexOf("\n}", start));
	};

	/** The meadow rule's body. */
	const meadowRule = () => {
		const start = css.indexOf(
			'#chat .chat-view[data-type="channel"] .chat,\n#chat .chat-view[data-type="query"] .chat {'
		);
		expect(start, "the meadow rule").to.be.greaterThan(-1);
		return css.slice(start, css.indexOf("\n}", start));
	};

	/** Top-level comma-separated entries of a declaration's value, var(--heart-cloud-2) counted as two. */
	const entries = (block: string, prop: string) => {
		const m = block.match(new RegExp(`\\n\\t${prop}:([^;]*);`));
		expect(m, prop).to.not.be.null;
		const value = m![1];
		let depth = 0;
		let count = 1;

		for (const c of value) {
			if (c === "(") {
				depth++;
			} else if (c === ")") {
				depth--;
			} else if (c === "," && depth === 0) {
				count++;
			}
		}

		return count + (value.includes("var(--heart-cloud-2)") ? 1 : 0);
	};

	it("paints three animal slots and a rainbow slot as layers, fourteen deep in every list", function () {
		const rule = meadowRule();

		for (const prop of ["background-image", "background-size", "background-position"]) {
			expect(entries(rule, prop), prop).to.equal(14);
		}

		const image = rule.match(/\n\tbackground-image:([^;]*);/)![1];
		const order = [
			"var(--heart-cloud-2)",
			"var(--heart-slot-b)",
			"var(--heart-slot-a)",
			"var(--heart-ground)",
			"var(--heart-slot-f)",
			"var(--heart-hill-far)",
			"var(--heart-rainbow)",
			"var(--heart-sky-deep)",
		];
		let at = -1;

		for (const token of order) {
			const next = image.indexOf(token, at + 1);
			expect(next, `${token} after the previous layer`).to.be.greaterThan(at);
			at = next;
		}

		expect(rule).to.include("auto calc(var(--strip) * var(--heart-slot-a-h))");
		expect(rule).to.include("calc(100% - var(--strip) * 0.295)"); // the visitor stands on the plateau
	});

	it("declares the eight animals' files, and every file it names exists", function () {
		for (const animal of CAST) {
			expect(css).to.include(`--heart-${animal}: url("heart/${animal}.svg");`);
			expect(css).to.include(`--heart-${animal}-far: url("heart/${animal}-far.svg");`);
			expect(css, `--heart-${animal}-h`).to.match(
				new RegExp(`--heart-${animal}-h: \\d*\\.\\d+;`)
			);
		}

		for (const [, file] of css.matchAll(/url\("(heart\/[^"]+\.svg)"\)/g)) {
			expect(
				fs.existsSync(path.resolve(__dirname, "../../client/themes/", file)),
				`${file} exists`
			).to.be.true;
		}
	});

	it("casts all eight, every scene, and holds no animal the user set aside", function () {
		const cast = new Map(CAST.map((animal) => [animal, [] as number[]]));
		const near = `var\\(--heart-(${CAST.join("|")})\\)`;

		for (const n of [0, 1, 2, 3, 4, 5]) {
			const body = sceneBody(n);
			expect(body, `scene ${n} casts slot a`).to.match(
				new RegExp(`--heart-slot-a: ${near};`)
			);
			expect(body, `scene ${n} sizes slot a`).to.match(
				new RegExp(`--heart-slot-a-h: var\\(--heart-(${CAST.join("|")})-h\\);`)
			);
			expect(body, `scene ${n} decides slot b`).to.match(
				new RegExp(`--heart-slot-b: (none|${near});`)
			);
			expect(body, `scene ${n} decides slot f`).to.match(
				new RegExp(`--heart-slot-f: (none|var\\(--heart-(${CAST.join("|")})-far\\));`)
			);

			for (const [, animal] of body.matchAll(
				/--heart-slot-[abf]: var\(--heart-([a-z]+?)(?:-far)?\);/g
			)) {
				cast.get(animal)!.push(n);
			}
		}

		for (const [animal, scenes] of cast) {
			expect(scenes, `${animal} is cast somewhere`).to.not.be.empty;
		}

		// The teddy bear and the dolphin were held: their rigs stay, their
		// files are gone (test/tools/heart/files.ts), and the theme must not
		// reach for either. Tokens and urls, not the bare word — the docs may
		// well end up explaining in a comment here why neither is cast.
		for (const held of ["teddy", "dolphin"]) {
			expect(css, `no --heart-${held} token`).to.not.include(`--heart-${held}`);
			expect(css, `no heart/${held} file`).to.not.include(`url("heart/${held}`);
		}
	});

	it("gives a phone a mid or large animal in every scene", function () {
		// Phones keep slot A and the distant visitor and drop slot B, so an
		// animal cast only into B never shows on one. Whichever way a pair is
		// cast, what survives must not be only a small creature.
		const small = ["frog", "ladybug", "bird"];

		for (const n of [0, 1, 2, 3, 4, 5]) {
			const body = sceneBody(n);
			const a = body.match(/--heart-slot-a: var\(--heart-([a-z]+)\);/)![1];
			expect(small, `scene ${n}'s near animal on a phone`).to.not.include(a);
		}
	});

	it("moves only x in the cloud keyframes, fourteen entries", function () {
		const start = css.indexOf("@keyframes heart-clouds");
		const block = css.slice(start, css.indexOf("\n}", start));
		expect(block).to.include("background-position-x:");
		expect(block).to.not.include("background-position-y");
		expect(block).to.not.match(/\n\t\tbackground-position:/);
		expect(entries(block.replace(/\n\t\t/g, "\n\t"), "background-position-x")).to.equal(14);
	});

	it("keeps two slots on phones and shows stills under reduced motion", function () {
		const phones = css.slice(
			css.indexOf("@media (max-width: 600px)"),
			css.indexOf("@media (prefers-reduced-motion: reduce)")
		);
		expect(phones).to.match(/#chat-container\[data-scene\] \{[^}]*--heart-slot-b: none;/);
		const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));

		for (const animal of CAST) {
			expect(reduced).to.include(`--heart-${animal}: url("heart/${animal}-still.svg");`);
			expect(reduced).to.include(
				`--heart-${animal}-far: url("heart/${animal}-far-still.svg");`
			);
		}

		expect(entries(reduced.replace(/\n\t\t/g, "\n\t"), "background-position")).to.equal(14);
	});

	it("raises a rainbow in scenes 2 and 5 on y alone", function () {
		expect(css).to.match(
			/--heart-rainbow-arc: radial-gradient\(circle farthest-side at 50% 100%/
		);

		for (const n of [2, 5]) {
			const start = css.indexOf(`#chat-container[data-scene="${n}"]`);
			expect(css.slice(start, css.indexOf("}", start)), `scene ${n}`).to.include(
				"--heart-rainbow: var(--heart-rainbow-arc);"
			);
		}

		const rule = meadowRule();
		expect(rule).to.match(
			/animation:\s*heart-clouds 90s linear infinite,\s*heart-rainbow 300s ease-in-out infinite;/
		);
		const start = css.indexOf("@keyframes heart-rainbow");
		const block = css.slice(start, css.indexOf("\n}", start));
		expect(block).to.include("background-position-y:");
		expect(block).to.not.include("background-position-x");
		expect(block).to.include("calc(100% - var(--strip) * 0.3)");
		const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
		expect(reduced).to.include("--heart-rainbow-y: calc(100% - var(--strip) * 0.3);");
	});

	it("keeps fourteen background-position-y entries in each of the rainbow's three keyframe groups", function () {
		const start = css.indexOf("@keyframes heart-rainbow");
		const block = css.slice(start, css.indexOf("\n}", start)).replace(/\n\t\t/g, "\n\t");
		let from = 0;

		for (let i = 0; i < 3; i++) {
			const idx = block.indexOf("background-position-y:", from);
			expect(idx, `group ${i}`).to.be.greaterThan(-1);
			const group = block.slice(block.lastIndexOf("\n", idx));
			expect(entries(group, "background-position-y"), `group ${i}`).to.equal(14);
			from = idx + 1;
		}
	});
});

/**
 * The rig-to-CSS coupling, from the rigs' side.
 *
 * An animal's size and travel on screen are four numbers that have to move
 * together: the rig's `viewBox.h` and `stage.aspect`, the theme's
 * `--heart-<animal>-h`, and the far slot the scenes give it. The generator's
 * audit can see the two in the rig and nothing at all in the stylesheet, and
 * that gap has already cost a round — four boxes grew to stop clipping their
 * animals (`lib/build.mjs` `boxOverflow`) and every one of them needed a
 * hand-made edit here that nothing would have missed if it had been skipped.
 *
 * So each cast rig records what the theme must say (`theme` in
 * `tools/heart/rigs/<animal>.mjs`) and this block derives the expectation
 * from it rather than restating it: grow a box, forget the token, and the
 * failure names the number to write.
 */
describe("the <3 theme's animals are the size their rigs say", function () {
	/** The cast, by the name its tokens and files use. */
	const RIGS: Record<string, any> = {horse, deer, puppy, bunny, kitten, frog, ladybug, bird};

	/** A distant visitor is 0.7 of its animal (the meadow's comment in heart.css). */
	const FAR_RATIO = 0.7;

	/** One scene rule's body. */
	const sceneBody = (n: number) => {
		const start = css.indexOf(`#chat-container[data-scene="${n}"]`);
		expect(start, `scene ${n}`).to.be.greaterThan(-1);
		return css.slice(start, css.indexOf("\n}", start));
	};

	for (const [name, def] of Object.entries(RIGS)) {
		describe(name, function () {
			it("was sized against the box the rig still has", function () {
				expect(def.theme, `${name}'s rig declares no theme block`).to.be.an("object");
				const {height, box} = def.theme;
				const now = def.rig.viewBox.h;
				expect(
					box,
					`${name}'s box is ${now} but --heart-${name}-h (${height}) was picked ` +
						`against ${box}: scale the token by ${now}/${box} to ` +
						`${Number(((height * now) / box).toFixed(4))}, scale stage.aspect by ` +
						`${box}/${now}, and set theme.box to ${now}`
				).to.equal(now);
			});

			it("is the height in heart.css that its rig says it is", function () {
				expect(css, `--heart-${name}-h`).to.include(
					`--heart-${name}-h: ${def.theme.height};`
				);
			});

			it("crosses the stage width its rig says it does", function () {
				const width = def.sequence.stage.aspect * def.rig.viewBox.h;
				expect(
					Math.abs(width - def.theme.stageWidth) / def.theme.stageWidth,
					`${name}'s stage is aspect ${def.sequence.stage.aspect} × box ` +
						`${def.rig.viewBox.h} = ${width.toFixed(1)} rig units, not the ` +
						`${def.theme.stageWidth} it was drawn for: scale stage.aspect to ` +
						`${Number((def.theme.stageWidth / def.rig.viewBox.h).toFixed(4))}`
				).to.be.below(0.001);
			});
		});
	}

	it("gives every slot the height token of the animal in it", function () {
		for (const n of [0, 1, 2, 3, 4, 5]) {
			const body = sceneBody(n);

			for (const slot of ["a", "b"]) {
				const animal = body.match(
					new RegExp(`--heart-slot-${slot}: var\\(--heart-([a-z]+)\\);`)
				);

				if (!animal) {
					continue; // an empty slot: `none`, and its height sizes nothing
				}

				expect(body, `scene ${n}'s slot ${slot} is a ${animal[1]}`).to.include(
					`--heart-slot-${slot}-h: var(--heart-${animal[1]}-h);`
				);
			}
		}
	});

	it("derives every distant visitor's height from its animal's own token", function () {
		let visitors = 0;

		for (const n of [0, 1, 2, 3, 4, 5]) {
			const body = sceneBody(n);
			const animal = body.match(/--heart-slot-f: var\(--heart-([a-z]+)-far\);/);

			if (!animal) {
				continue; // no visitor on that scene's plateau
			}

			visitors++;
			expect(body, `scene ${n}'s visitor is a ${animal[1]}`).to.include(
				`--heart-slot-f-h: calc(${FAR_RATIO} * var(--heart-${animal[1]}-h));`
			);
		}

		expect(visitors, "scenes with a distant visitor").to.equal(5);
	});
});
