import {expect} from "chai";
import {
	DEFAULT_REACTIONS,
	MAX_RECENT,
	mergeRecent,
	recentReactions,
	rememberReaction,
	STORAGE_KEY,
	useStorageBackend,
} from "../../client/js/helpers/reactionRecents";

describe("recently used reactions (helpers/reactionRecents.ts)", function () {
	let store: Map<string, string>;

	beforeEach(function () {
		store = new Map<string, string>();
		useStorageBackend({
			get: (key) => store.get(key) ?? null,
			set: (key, value) => void store.set(key, value),
			remove: (key) => void store.delete(key),
		});
	});

	afterEach(function () {
		useStorageBackend(null);
	});

	it("has defaults to show before anything has been used", function () {
		expect(recentReactions()).to.be.empty;
		expect(DEFAULT_REACTIONS).to.include("👍");
	});

	it("puts the newest first, without repeating one", function () {
		expect(mergeRecent(["👍", "🎉"], "🎉")).to.deep.equal(["🎉", "👍"]);
		expect(mergeRecent(["👍"], "lol")).to.deep.equal(["lol", "👍"]);
		expect(mergeRecent([], "👍")).to.deep.equal(["👍"]);
	});

	it("forgets the oldest once it is full", function () {
		const full = Array.from({length: MAX_RECENT}, (_, i) => `r${i}`);
		const merged = mergeRecent(full, "new");

		expect(merged).to.have.lengthOf(MAX_RECENT);
		expect(merged[0]).to.equal("new");
		expect(merged).to.not.include(`r${MAX_RECENT - 1}`);
	});

	it("remembers reactions across reads, words as well as emoji", function () {
		rememberReaction("👍");
		rememberReaction("lol");
		rememberReaction("🎉🎉🎉");
		rememberReaction("👍");

		expect(recentReactions()).to.deep.equal(["👍", "🎉🎉🎉", "lol"]);
		expect(store.get(STORAGE_KEY)).to.equal(JSON.stringify(["👍", "🎉🎉🎉", "lol"]));
	});

	it("ignores an empty reaction", function () {
		rememberReaction("");
		expect(store.has(STORAGE_KEY)).to.equal(false);
	});

	it("drops a stored list it cannot read", function () {
		store.set(STORAGE_KEY, "{not json");
		expect(recentReactions()).to.be.empty;
		expect(store.has(STORAGE_KEY)).to.equal(false);
	});

	it("skips entries that are not usable reactions", function () {
		store.set(STORAGE_KEY, JSON.stringify(["👍", 42, "", null, "🎉".repeat(500)]));
		expect(recentReactions()).to.deep.equal(["👍"]);
	});
});
