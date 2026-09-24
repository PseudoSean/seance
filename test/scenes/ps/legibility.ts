import {expect} from "chai";
import fs from "fs";
import path from "path";
import {contrast, luminance, mix} from "../../../client/js/scenes/ps/colour";
import {checkedGrounds, INK, INK_FAINT} from "../../../tools/ps/legibility";

const css = fs.readFileSync(path.resolve(__dirname, "../../../client/themes/ps.css"), "utf8");
const block = css.slice(
	css.indexOf("/* ps:message-palette:start"),
	css.indexOf("/* ps:message-palette:end */")
);

/** The worst (lowest-contrast) effective ground for a colour under one treatment, over every checked moment. */
function worst(
	colour: string,
	text: "ink" | "light",
	faint = false
): {ratio: number; where: string} {
	const lc = luminance(colour);
	let best = {ratio: Infinity, where: ""};

	for (const g of checkedGrounds()[text]) {
		// Faint light text is white at 80 % over its own ground.
		const lf = faint ? luminance(mix(g.hex, "#ffffff", 0.8)) : lc;
		const ratio = (Math.max(lf, g.lum) + 0.05) / (Math.min(lf, g.lum) + 0.05);

		if (ratio < best.ratio) {
			best = {ratio, where: g.where};
		}
	}

	return best;
}

/** The block without its comments, so the header comment glued to the first rule does not hide that rule's selector. */
const rules = block.replace(/\/\*[\s\S]*?\*\//g, "");

/** `name: #rrggbb` pairs declared in the block under a selector that starts with `prefix`; faint ink has its own floor and is left out. */
function declared(prefix: string): Array<[string, string]> {
	const out: Array<[string, string]> = [];

	for (const rule of rules.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
		if (!rule[1].trim().startsWith(prefix)) {
			continue;
		}

		for (const d of rule[2].matchAll(/(--[a-z0-9-]+|color):\s*(#[0-9a-f]{6});/g)) {
			if (!d[1].includes("-faint")) {
				out.push([`${rule[1].trim()} ${d[1]}`, d[2]]);
			}
		}
	}

	return out;
}

describe("ps: the words over the plains keep their floors at every minute, season and weather", function () {
	this.timeout(60000);

	it("the generated block exists", function () {
		expect(block.length).to.be.greaterThan(100);
	});

	it("holds the spec's own ink and faint ink by day, and white by night (a failure here is reported, not tuned)", function () {
		expect(worst(INK, "ink").ratio).to.be.at.least(4.5);
		expect(worst(INK_FAINT, "ink").ratio).to.be.at.least(3);
		expect(worst("#ffffff", "light").ratio).to.be.at.least(4.5);
		expect(worst("#ffffff", "light", true).ratio).to.be.at.least(3);
	});

	it("holds every generated daytime colour at 4.5:1", function () {
		for (const [name, hex] of declared("#chat .chat")) {
			const w = worst(hex, "ink");
			expect(w.ratio, `${name} ${hex} at ${w.where}`).to.be.at.least(4.5);
		}
	});

	it("holds every generated dusk-and-night colour at 4.5:1", function () {
		for (const [name, hex] of declared(':root[data-ps-text="light"] #chat .chat')) {
			const w = worst(hex, "light");
			expect(w.ratio, `${name} ${hex} at ${w.where}`).to.be.at.least(4.5);
		}
	});

	it("covers all 32 nick colours in both treatments", function () {
		const ink = declared("#chat .chat .user.color-").length;
		const light = declared(':root[data-ps-text="light"] #chat .chat .user.color-').length;
		expect([ink, light]).to.deep.equal([32, 32]);
	});

	it("reads the semantic rules in both treatments, not only the nicks", function () {
		// The header comment is glued to the first rule's selector; a reader
		// that kept it would skip that rule and hold nothing but the nicks.
		const names = (prefix: string) => declared(prefix).map(([name]) => name);
		expect(names("#chat .chat")).to.include("#chat .chat --chat-fg");
		expect(names("#chat .chat")).to.include("#chat .chat --link-color");
		expect(names(':root[data-ps-text="light"] #chat .chat')).to.include(
			':root[data-ps-text="light"] #chat .chat --link-color'
		);
	});

	it("holds every generated colour on a mentioned row, under its wash by day and by night", function () {
		const cases: Array<[Array<[string, string]>, "ink" | "light", string, number]> = [
			[declared("#chat .chat"), "ink", "#ffd6e6", 0.85],
			[declared(':root[data-ps-text="light"] #chat .chat'), "light", "#140e1e", 0.5],
		];

		for (const [colours, text, wash, strength] of cases) {
			const lums = colours.map(([name, hex]) => ({name, hex, lum: luminance(hex)}));

			for (const g of checkedGrounds()[text]) {
				const lw = luminance(mix(g.hex, wash, strength));

				for (const c of lums) {
					const ratio = (Math.max(c.lum, lw) + 0.05) / (Math.min(c.lum, lw) + 0.05);

					if (ratio < 4.5) {
						expect.fail(
							`${c.name} ${c.hex} on a mention at ${g.where}: ${ratio.toFixed(2)}:1`
						);
					}
				}
			}
		}
	});

	it("names its worst grounds, so a failure says where", function () {
		expect(contrast(INK, "#ffffff")).to.be.greaterThan(4.5);
		expect(checkedGrounds().ink.length).to.be.greaterThan(1000);
		expect(checkedGrounds().light.length).to.be.greaterThan(1000);
	});
});
