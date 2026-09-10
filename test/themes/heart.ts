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

	it("keeps text at 4.5:1 on the sky and on a highlighted row", function () {
		const value = (token: string) =>
			css.match(new RegExp(`^\\s*${token}:\\s*(#[0-9a-f]{6});`, "m"))![1];

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
			"heart/nunito-600.woff2",
			"heart/nunito-600-italic.woff2",
			"heart/nunito-800.woff2",
			"heart/baloo2-700.woff2",
		]) {
			expect(css).to.include(`url("${file}")`);
		}

		expect(css).to.match(/font-family:\s*Nunito/);
		expect(css).to.match(/font-weight:\s*600/);
		expect(css).to.match(/font-family:\s*"Baloo 2"/);
	});
});

describe("the <3 theme's motion", function () {
	it("fades messages in, raises the chrome, glows a mention, and stands down under reduced motion", function () {
		expect(css).to.include("@keyframes heart-fade");
		expect(css).to.match(/#chat \.msg \{[^}]*animation: heart-fade 340ms ease-out/);
		expect(css).to.include("@keyframes heart-rise");
		expect(css).to.include("@keyframes heart-glow");
		expect(css).to.match(
			/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*animation: none !important/
		);
	});
});
