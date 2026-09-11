import {expect} from "chai";
import {conversationSeed} from "../../client/js/helpers/channelSeed";

describe("conversation seed (helpers/channelSeed.ts)", function () {
	it("is deterministic and case-insensitive", function () {
		expect(conversationSeed("#seance")).to.deep.equal(conversationSeed("#Seance"));
		expect(conversationSeed("#seance")).to.deep.equal(conversationSeed("#SEANCE"));
	});

	it("gives a scene in 0..5 and a seed in [0, 1)", function () {
		for (const name of ["#seance", "#dev", "#docs", "mira", "#a", "#zebra-crossing"]) {
			const {scene, seed} = conversationSeed(name);
			expect(scene).to.be.within(0, 5);
			expect(Number.isInteger(scene)).to.be.true;
			expect(seed).to.be.within(0, 1);
			expect(seed).to.be.below(1);
		}
	});

	it("separates sibling names", function () {
		expect(conversationSeed("#dev").seed).to.not.equal(conversationSeed("#docs").seed);
		expect(conversationSeed("#dev").seed).to.not.equal(conversationSeed("#deu").seed);
	});

	it("pins the hash so a channel's meadow survives a rebuild", function () {
		// FNV-1a 32-bit of "#seance": if this changes, every deploy's meadows change.
		expect(conversationSeed("#seance")).to.deep.equal({scene: 3, seed: 0.2081});
	});

	it("clamps a seed that would round up to 1", function () {
		// FNV-1a 32-bit of "#chan34397" rounds to exactly 1 before clamping.
		expect(conversationSeed("#chan34397").seed).to.equal(0.9999);
		expect(conversationSeed("#chan34397").seed).to.be.below(1);
	});
});
