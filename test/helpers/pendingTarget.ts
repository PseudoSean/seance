import {expect} from "chai";
import {
	PENDING_TARGET_TTL_MS,
	clearPendingTarget,
	getPendingTarget,
	isChannelTarget,
	matchesPendingTarget,
	setPendingTarget,
	takePendingTarget,
} from "../../client/js/helpers/pendingTarget";

describe("pendingTarget", function () {
	afterEach(function () {
		clearPendingTarget();
	});

	it("remembers a network/target pair until it is taken", function () {
		setPendingTarget("net-1", "#seance", 1000);

		expect(getPendingTarget(1000)).to.deep.equal({
			network: "net-1",
			target: "#seance",
			at: 1000,
		});
		expect(takePendingTarget(1000)).to.deep.equal({
			network: "net-1",
			target: "#seance",
			at: 1000,
		});
		expect(getPendingTarget(1000)).to.equal(null);
	});

	it("matches the join case-insensitively and only on its own network", function () {
		setPendingTarget("net-1", "#Seance", 1000);

		expect(matchesPendingTarget("net-1", "#seance", 1000)).to.equal(true);
		expect(matchesPendingTarget("net-2", "#seance", 1000)).to.equal(false);
		expect(matchesPendingTarget("net-1", "#other", 1000)).to.equal(false);
	});

	it("expires: a join that never came must not hijack a later session", function () {
		setPendingTarget("net-1", "#seance", 1000);

		expect(getPendingTarget(1000 + PENDING_TARGET_TTL_MS)).to.not.equal(null);
		expect(getPendingTarget(1001 + PENDING_TARGET_TTL_MS)).to.equal(null);
		expect(matchesPendingTarget("net-1", "#seance", 5000 + PENDING_TARGET_TTL_MS)).to.equal(
			false
		);
	});

	it("tells channels from nicks by prefix", function () {
		expect(isChannelTarget("#seance")).to.equal(true);
		expect(isChannelTarget("&local")).to.equal(true);
		expect(isChannelTarget("alice")).to.equal(false);
	});
});
