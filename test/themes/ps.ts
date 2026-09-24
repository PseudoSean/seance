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

const css = fs.readFileSync(path.resolve(__dirname, "../../client/themes/ps.css"), "utf8");

describe("the ps theme (client/themes/ps.css)", function () {
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

describe("the ps theme's colours", function () {
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

describe("the ps theme's type", function () {
	it("bundles Nunito and Baloo 2 as variable fonts and sets them at the chosen weights", function () {
		for (const file of [
			"ps/nunito-variable.woff2",
			"ps/nunito-variable-italic.woff2",
			"ps/baloo2-variable.woff2",
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
			/#chat \.header \{\s*background: var\(--ps-paper\);/
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

describe("the ps theme's motion", function () {
	it("fades messages in, raises the chrome, glows a mention, and stands down under reduced motion", function () {
		expect(css).to.include("@keyframes ps-fade");
		expect(css).to.match(/#chat \.msg \{[^}]*animation: ps-fade 340ms ease-out backwards/);
		expect(css).to.match(/#chat \.msg\.pending \{[^}]*animation-name: none/);
		expect(css).to.include("@keyframes ps-rise");
		expect(css).to.include("@keyframes ps-glow");
		expect(css).to.match(
			/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation: none !important/
		);
	});
});

describe("the ps theme has no glitter", function () {
	// The <3 theme burst sparks, hearts and stars off an own message and a
	// reaction's arrival. ps is peace on the plains: the bursts are gone and
	// nothing has replaced them yet (docs/projects/ps-theme.md).
	it("hangs nothing off a message, a reaction or an enter class", function () {
		expect(css, "no burst tokens").to.not.match(/--ps-burst-/);
		expect(css, "no sparkle keyframes").to.not.match(/@keyframes [\w-]*sparkle/);
		expect(css, "no send burst").to.not.match(/\.msg\.self:last-child/);
		expect(css, "no pseudo-element on a message").to.not.match(
			/\.msg\b[^{},]*::(before|after)/
		);
		expect(css, "no pseudo-element on a reaction").to.not.match(
			/msg-reaction[^{},]*::(before|after)/
		);
		expect(css, "no pseudo-element on an enter class").to.not.match(
			/enter-active[^{},]*::(before|after)/
		);
	});

	it("leaves the reaction pop to style.css, restating neither enter class", function () {
		// MessageReactions.vue's Transition wrappers and style.css's 160 ms
		// reaction-pop serve every theme; the <3 theme restated them to hold the
		// class open for its burst (heart-hold), which ps does not need.
		expect(css).to.not.include(".reaction-enter-active");
		expect(css).to.not.include(".reactions-enter-active");
		expect(css, "no do-nothing hold animation").to.not.match(/@keyframes [\w-]*hold\b/);
	});
});

describe("the ps theme's scene", function () {
	const style = fs.readFileSync(path.resolve(__dirname, "../../client/css/style.css"), "utf8");

	it("is hidden by style.css for every theme, and shown by ps", function () {
		expect(style).to.match(/#theme-scene\s*\{\s*display:\s*none;\s*\}/);
		expect(css).to.match(/#theme-scene\s*\{[^}]*display:\s*block;/);
	});

	it("paints daylight when the scene is absent: sky and canvas from the midday stop, and a halo, outside any state selector", function () {
		expect(css).to.match(/#theme-scene\s*\{[^}]*var\(--ps-sky-top,\s*#3f8fe6\)/);
		const root = css.match(/:root\s*\{[^}]*--canvas-bg-color:\s*#3f8fe6;[^}]*\}/);
		expect(root, "a :root block defines the daylight canvas").to.not.equal(null);
		expect(css).to.match(/--ps-halo:\s*#ebf5fd;/);
		expect(css).to.not.match(/\[data-ps-(light|text)[^\]]*\][^{]*\{[^}]*--canvas-bg-color/);
	});

	it("stops every scene animation while paused and under reduced motion", function () {
		expect(css).to.match(
			/#theme-scene\.ps-paused \*\s*\{\s*animation-play-state:\s*paused !important;/
		);
		const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
		expect(reduced).to.match(/#theme-scene \*[^{]*\{\s*animation:\s*none !important;/);
	});

	it("no longer paints a meadow on the message area or reads the channel seed", function () {
		expect(css).to.not.include("--channel-seed");
		expect(css).to.not.include("data-scene");
		expect(css).to.not.include("ps-rainbow");
		expect(css).to.not.include("ps-clouds");
	});
});

describe("the ps theme's animals", function () {
	/** The cast (tools/heart/README.md); the teddy and the dolphin are held. */
	const CAST = ["horse", "deer", "puppy", "bunny", "kitten", "frog", "ladybug", "bird"];

	it("declares the eight animals' files, and every file it names exists", function () {
		for (const animal of CAST) {
			expect(css).to.include(`--ps-${animal}: url("ps/${animal}.svg");`);
			expect(css).to.include(`--ps-${animal}-far: url("ps/${animal}-far.svg");`);
			expect(css, `--ps-${animal}-h`).to.match(new RegExp(`--ps-${animal}-h: \\d*\\.\\d+;`));
		}

		for (const [, file] of css.matchAll(/url\("(ps\/[^"]+\.svg)"\)/g)) {
			expect(
				fs.existsSync(path.resolve(__dirname, "../../client/themes/", file)),
				`${file} exists`
			).to.be.true;
		}

		// The teddy bear and the dolphin were held: their rigs stay, their
		// files are gone (test/tools/heart/files.ts), and the theme must not
		// reach for either. Tokens and urls, not the bare word — the docs may
		// well end up explaining in a comment here why neither is cast.
		for (const held of ["teddy", "dolphin"]) {
			expect(css, `no --ps-${held} token`).to.not.include(`--ps-${held}`);
			expect(css, `no ps/${held} file`).to.not.include(`url("ps/${held}`);
		}
	});
});

describe("the ps theme's animals, switched off in the scene's animal layer", function () {
	it("casts a horse and a bunny near and a deer far off", function () {
		const root = css.match(/:root\s*\{[^}]*--ps-slot-a:[^}]*\}/)?.[0] ?? "";
		expect(root).to.include("--ps-slot-a: var(--ps-horse);");
		expect(root).to.include("--ps-slot-b: var(--ps-bunny);");
		expect(root).to.include("--ps-slot-f: var(--ps-deer-far);");
	});

	it("paints the three slots as the animal layer's background layers", function () {
		const layer = css.match(/#theme-scene \.ps-animals\s*\{[^}]*\}/)?.[0] ?? "";
		expect(layer).to.match(
			/background-image:\s*var\(--ps-slot-b\),\s*var\(--ps-slot-a\),\s*var\(--ps-slot-f\);/
		);
	});

	it("empties every slot with one block after the cast, which nothing after it undoes", function () {
		const off =
			/#theme-scene \.ps-animals\s*\{\s*--ps-slot-a:\s*none;\s*--ps-slot-b:\s*none;\s*--ps-slot-f:\s*none;\s*\}/g;
		const matches = [...css.matchAll(off)];
		expect(matches, "exactly one off block").to.have.length(1);
		const after = css.slice(matches[0].index! + matches[0][0].length);
		expect(after).to.not.match(/--ps-slot-[abf]:\s*var\(/);
	});
});

/**
 * The rig-to-CSS coupling, from the rigs' side.
 *
 * An animal's size and travel on screen are four numbers that have to move
 * together: the rig's `viewBox.h` and `stage.aspect`, the theme's
 * `--ps-<animal>-h`, and the far slot the cast gives it. The generator's
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
describe("the ps theme's animals are the size their rigs say", function () {
	/** The cast, by the name its tokens and files use. */
	const RIGS: Record<string, any> = {horse, deer, puppy, bunny, kitten, frog, ladybug, bird};

	/** A distant visitor is 0.7 of its animal (the animal tokens' comment in ps.css). */
	const FAR_RATIO = 0.7;

	/** The :root block that casts the scene's animal layer. */
	const cast = () => {
		const block = css.match(/:root\s*\{[^}]*--ps-slot-a:[^}]*\}/);
		expect(block, "the cast's :root block").to.not.equal(null);
		return block![0];
	};

	for (const [name, def] of Object.entries(RIGS)) {
		describe(name, function () {
			it("was sized against the box the rig still has", function () {
				expect(def.theme, `${name}'s rig declares no theme block`).to.be.an("object");
				const {height, box} = def.theme;
				const now = def.rig.viewBox.h;
				expect(
					box,
					`${name}'s box is ${now} but --ps-${name}-h (${height}) was picked ` +
						`against ${box}: scale the token by ${now}/${box} to ` +
						`${Number(((height * now) / box).toFixed(4))}, scale stage.aspect by ` +
						`${box}/${now}, and set theme.box to ${now}`
				).to.equal(now);
			});

			it("is the height in ps.css that its rig says it is", function () {
				expect(css, `--ps-${name}-h`).to.include(`--ps-${name}-h: ${def.theme.height};`);
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

	it("gives each near slot the height token of the animal in it", function () {
		const body = cast();

		for (const slot of ["a", "b"]) {
			const animal = body.match(new RegExp(`--ps-slot-${slot}: var\\(--ps-([a-z]+)\\);`));
			expect(animal, `slot ${slot} casts an animal`).to.not.equal(null);
			expect(body, `slot ${slot} is a ${animal![1]}`).to.include(
				`--ps-slot-${slot}-h: var(--ps-${animal![1]}-h);`
			);
		}
	});

	it("derives the distant visitor's height from its animal's own token", function () {
		const body = cast();
		const animal = body.match(/--ps-slot-f: var\(--ps-([a-z]+)-far\);/);
		expect(animal, "slot f casts a distant visitor").to.not.equal(null);
		expect(body, `the visitor is a ${animal![1]}`).to.include(
			`--ps-slot-f-h: calc(${FAR_RATIO} * var(--ps-${animal![1]}-h));`
		);
	});
});
