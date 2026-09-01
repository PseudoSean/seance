import {expect} from "chai";
import {
	emojiForName,
	EmojiGroup,
	expandShortcodes,
	flatten,
	isEmojiOnly,
	loadEmojiCatalog,
	MAX_REACTION_LENGTH,
	normalizeReaction,
	searchEmoji,
} from "../../client/js/helpers/emoji";

describe("emoji catalog and reaction text (helpers/emoji.ts)", function () {
	let catalog: EmojiGroup[];

	before(async function () {
		catalog = await loadEmojiCatalog();
	});

	describe("the catalog", function () {
		it("is the nine unicode groups, each with a tab icon and entries", function () {
			expect(catalog.map((group) => group.key)).to.deep.equal([
				"smileys",
				"people",
				"nature",
				"food",
				"activities",
				"places",
				"objects",
				"symbols",
				"flags",
			]);

			for (const group of catalog) {
				expect(group.label, group.key).to.be.a("string").and.not.empty;
				expect(group.icon, group.key).to.be.a("string").and.not.empty;
				expect(group.emoji.length, group.key).to.be.above(0);
			}
		});

		it("is loaded once and handed to every caller", async function () {
			expect(await loadEmojiCatalog()).to.equal(catalog);
		});

		it("gives every entry a name, a description and a lowercase haystack", function () {
			const entries = flatten(catalog);
			expect(entries.length).to.be.above(1500);

			for (const entry of entries) {
				expect(entry.name, entry.emoji).to.match(/^[a-z0-9_+-]+$/);
				expect(entry.description, entry.emoji).to.be.a("string").and.not.empty;
				expect(entry.haystack, entry.emoji).to.equal(entry.haystack.toLowerCase());
				expect(entry.haystack, entry.emoji).to.include(` ${entry.name} `);
			}
		});
	});

	describe("searching", function () {
		const first = (query: string) => searchEmoji(catalog, query)[0]?.emoji;

		it("puts the emoji whose name was typed first", function () {
			expect(first("tada")).to.equal("🎉");
			expect(first("thumbsup")).to.equal("👍");
			expect(first("sweat_smile")).to.equal("😅");
		});

		it("reads a shortcode, spaces and capitals as the same query", function () {
			expect(first(":tada:")).to.equal("🎉");
			expect(first("Sweat Smile")).to.equal("😅");
			expect(first("  tada  ")).to.equal("🎉");
		});

		it("matches descriptions and keywords, and needs every word to match", function () {
			expect(first("party popper")).to.equal("🎉");
			expect(searchEmoji(catalog, "smiling")).to.not.be.empty;
			expect(searchEmoji(catalog, "tada nonsense")).to.be.empty;
		});

		it("knows an exact alias from a word that merely starts one", function () {
			// What the picker highlights first hangs off this: `tada` names an
			// emoji, `lol` is a word that happens to prefix `lollipop`.
			expect(emojiForName("tada")).to.equal("🎉");
			expect(emojiForName(":tada:")).to.equal("🎉");
			expect(emojiForName("  TADA ")).to.equal("🎉");
			expect(emojiForName("+1")).to.equal("👍");
			expect(emojiForName("lol")).to.be.undefined;
			expect(emojiForName("")).to.be.undefined;
			expect(first("lol")).to.equal("🍭");
		});

		it("finds an emoji that was pasted in", function () {
			expect(first("🎉")).to.equal("🎉");
		});

		it("returns nothing for an empty query and honours the limit", function () {
			expect(searchEmoji(catalog, "")).to.be.empty;
			expect(searchEmoji(catalog, "   ")).to.be.empty;
			expect(searchEmoji(catalog, "face", 5)).to.have.lengthOf(5);
		});
	});

	describe("reaction text", function () {
		it("expands the shortcodes it knows and leaves the rest alone", function () {
			expect(expandShortcodes("look :tada: here")).to.equal("look 🎉 here");
			expect(expandShortcodes(":not_an_emoji:")).to.equal(":not_an_emoji:");
			expect(expandShortcodes("10:30:45")).to.equal("10:30:45");
		});

		it("normalises what was typed", function () {
			expect(normalizeReaction("  :tada: ")).to.equal("🎉");
			expect(normalizeReaction("so\t very  cool")).to.equal("so very cool");
			expect(normalizeReaction("   ")).to.equal("");
			expect(normalizeReaction("bell\u0007ringer")).to.equal("bell ringer");
		});

		it("cuts an over-long reaction on a code point boundary", function () {
			const long = "🎉".repeat(MAX_REACTION_LENGTH + 10);
			const cut = normalizeReaction(long);

			expect(Array.from(cut)).to.have.lengthOf(MAX_REACTION_LENGTH);
			expect(cut).to.equal("🎉".repeat(MAX_REACTION_LENGTH));
		});

		it("tells emoji from words, however many there are", function () {
			expect(isEmojiOnly("👍")).to.equal(true);
			expect(isEmojiOnly("🎉🎉🎉")).to.equal(true);
			expect(isEmojiOnly("👍 ❤️")).to.equal(true);
			expect(isEmojiOnly("lol")).to.equal(false);
			expect(isEmojiOnly("👍 nice")).to.equal(false);
			expect(isEmojiOnly("")).to.equal(false);
		});
	});
});
