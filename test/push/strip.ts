import {expect} from "chai";
import {
	notificationText,
	splitAction,
	stripFormatting,
	stripMarkdown,
} from "../../client/js/push/strip";

describe("push/strip", function () {
	describe("stripFormatting", function () {
		it("removes IRC colour and style bytes and trims", function () {
			expect(stripFormatting("\x02bold\x02 \x034,1red\x03 \x1funder\x1f ")).to.equal(
				"bold red under"
			);
		});
	});

	describe("stripMarkdown", function () {
		it("removes inline markers", function () {
			expect(stripMarkdown("**bold** and *it* and `code` and ~~gone~~")).to.equal(
				"bold and it and code and gone"
			);
		});

		it("removes block markers across lines", function () {
			expect(stripMarkdown("# Title\n```js\nlet x = 1;\n```\n> quoted")).to.equal(
				"Titlelet x = 1;quoted"
			);
		});

		it("leaves an unclosed marker literal and never loses characters", function () {
			expect(stripMarkdown("**bold that got cut")).to.equal("**bold that got cut");
			expect(stripMarkdown("```js\nlet x = 1;")).to.equal("```js\nlet x = 1;");
		});

		it("strips a math span to its TeX source", function () {
			expect(stripMarkdown("see $x^2$ here")).to.equal("see $x^2$ here");
		});
	});

	describe("splitAction", function () {
		it("splits a CTCP ACTION, with or without the closing byte", function () {
			expect(splitAction("\x01ACTION waves\x01")).to.deep.equal({
				action: true,
				body: "waves",
			});
			expect(splitAction("\x01ACTION waves")).to.deep.equal({action: true, body: "waves"});
			expect(splitAction("plain")).to.deep.equal({action: false, body: "plain"});
		});
	});

	describe("notificationText", function () {
		it("strips formatting always and markdown only when asked", function () {
			expect(notificationText("\x02**hi**\x02", {markdown: false})).to.equal("**hi**");
			expect(notificationText("\x02**hi**\x02", {markdown: true})).to.equal("hi");
		});

		it("keeps the action marks around a stripped action", function () {
			expect(notificationText("\x01ACTION *waves*\x01", {markdown: true})).to.equal(
				"*waves*"
			);
			expect(notificationText("\x01ACTION waves\x01", {markdown: false})).to.equal("*waves*");
		});

		it("strips a joined multiline message as one text", function () {
			expect(notificationText("```\nlet x;\n```", {markdown: true})).to.equal("let x;");
		});
	});
});
