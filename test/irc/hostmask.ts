import {expect} from "chai";
import {
	compareHostmask,
	compareWithWildcard,
	formatHostmask,
	parseHostmask,
} from "../../client/js/irc/hostmask";

describe("irc/hostmask", function () {
	describe("parseHostmask", function () {
		it("splits nick!ident@host and lower-cases every part", function () {
			expect(parseHostmask("Bob!~Ident@Host.Example")).to.deep.equal({
				nick: "bob",
				ident: "~ident",
				hostname: "host.example",
			});
		});

		it("fills missing parts with *", function () {
			expect(parseHostmask("bob")).to.deep.equal({nick: "bob", ident: "*", hostname: "*"});
			expect(parseHostmask("bob!ident")).to.deep.equal({
				nick: "bob",
				ident: "ident",
				hostname: "*",
			});
			expect(parseHostmask("bob@host")).to.deep.equal({
				nick: "bob",
				ident: "*",
				hostname: "host",
			});
			expect(parseHostmask("*!*@host")).to.deep.equal({
				nick: "*",
				ident: "*",
				hostname: "host",
			});
		});

		it("treats empty parts as wildcards", function () {
			expect(parseHostmask("bob!@")).to.deep.equal({nick: "bob", ident: "*", hostname: "*"});
			expect(parseHostmask("")).to.deep.equal({nick: "*", ident: "*", hostname: "*"});
		});

		it("round-trips through formatHostmask", function () {
			expect(formatHostmask(parseHostmask("Bob@host"))).to.equal("bob!*@host");
		});
	});

	describe("compareWithWildcard", function () {
		it("matches * and ? like IRC wildcards, case-insensitively", function () {
			expect(compareWithWildcard("*", "anything")).to.equal(true);
			expect(compareWithWildcard("*", "")).to.equal(true);
			expect(compareWithWildcard("b?b", "BOB")).to.equal(true);
			expect(compareWithWildcard("b?b", "bobb")).to.equal(false);
			expect(compareWithWildcard("*.example.org", "user.example.org")).to.equal(true);
			expect(compareWithWildcard("bob", "bobby")).to.equal(false);
		});

		it("escapes regex metacharacters in the pattern", function () {
			expect(compareWithWildcard("a.b", "axb")).to.equal(false);
			expect(compareWithWildcard("a.b", "a.b")).to.equal(true);
			expect(compareWithWildcard("[bob]", "[BOB]")).to.equal(true);
			expect(compareWithWildcard("a\\b", "a\\b")).to.equal(true);
		});
	});

	describe("compareHostmask", function () {
		it("requires every part of the pattern to match", function () {
			const pattern = parseHostmask("*!*@*.evil.example");
			expect(compareHostmask(pattern, parseHostmask("troll!x@lair.evil.example"))).to.equal(
				true
			);
			expect(compareHostmask(pattern, parseHostmask("troll!x@nice.example"))).to.equal(false);
			expect(
				compareHostmask(parseHostmask("troll"), parseHostmask("troll!x@nice.example"))
			).to.equal(true);
			expect(
				compareHostmask(parseHostmask("troll!y"), parseHostmask("troll!x@nice.example"))
			).to.equal(false);
		});
	});
});
