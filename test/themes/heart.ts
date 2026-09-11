import {expect} from "chai";
import fs from "fs";
import path from "path";

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
	it("bundles Nunito and Baloo 2 and sets them at the chosen weights", function () {
		for (const file of [
			"heart/nunito-400.woff2",
			"heart/nunito-400-italic.woff2",
			"heart/nunito-800.woff2",
			"heart/baloo2-700.woff2",
		]) {
			expect(css).to.include(`url("${file}")`);
		}

		expect(css).to.match(/#chat \.msg \.user[\s\S]{0,160}font-family:\s*"Baloo 2"/);
		expect(css).to.match(
			/body,[\s\S]{0,200}font-family:\s*Nunito[\s\S]{0,80}font-weight:\s*400/
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
