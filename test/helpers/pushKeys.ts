import {expect} from "chai";
import {
	decodeApplicationServerKey,
	sameApplicationServerKey,
	subscriptionIsStale,
} from "../../client/js/helpers/pushKeys";

// The testnet ircd's key, as `draft/webpush=vapid=<key>` carries it in CAP LS.
const TESTNET_VAPID =
	"BLB6-4OioBPa__W4w93qeXLpdHYwSr8xONZjy_8uA1CpBkiyd_lc8ztobgKxEs1F7dFHQGB3yW5mgi54GkJBnGU";

describe("pushKeys — decodeApplicationServerKey", () => {
	it("decodes URL-safe base64 without padding", () => {
		expect([...decodeApplicationServerKey("AQID")]).to.deep.equal([1, 2, 3]);
		expect([...decodeApplicationServerKey("-_8")]).to.deep.equal([0xfb, 0xff]);
	});

	it("decodes a VAPID public key to its 65 uncompressed-point bytes", () => {
		const key = decodeApplicationServerKey(TESTNET_VAPID);

		expect(key.length).to.equal(65);
		expect(key[0]).to.equal(0x04);
	});
});

describe("pushKeys — sameApplicationServerKey", () => {
	const wanted = decodeApplicationServerKey("AQID");

	it("is false when the browser subscription carries no key", () => {
		expect(sameApplicationServerKey(null, wanted)).to.equal(false);
		expect(sameApplicationServerKey(undefined, wanted)).to.equal(false);
	});

	it("compares the key byte for byte", () => {
		expect(sameApplicationServerKey(Uint8Array.from([1, 2, 3]).buffer, wanted)).to.equal(true);
		expect(sameApplicationServerKey(Uint8Array.from([1, 2, 4]).buffer, wanted)).to.equal(false);
		expect(sameApplicationServerKey(Uint8Array.from([1, 2]).buffer, wanted)).to.equal(false);
	});

	it("accepts a typed-array view as well as a raw buffer", () => {
		expect(sameApplicationServerKey(Uint8Array.from([1, 2, 3]), wanted)).to.equal(true);
	});
});

describe("pushKeys — subscriptionIsStale", () => {
	it("is false with nothing stored", () => {
		expect(subscriptionIsStale([], ["K"])).to.equal(false);
	});

	it("is false while no connected server announces a key", () => {
		expect(subscriptionIsStale(["K"], [])).to.equal(false);
		expect(subscriptionIsStale(["K"], [undefined])).to.equal(false);
	});

	it("is false when a stored subscription matches an announced key", () => {
		expect(subscriptionIsStale(["K"], ["K"])).to.equal(false);
		expect(subscriptionIsStale(["K"], ["X", "K"])).to.equal(false);
	});

	it("is true when servers announce keys and none matches", () => {
		expect(subscriptionIsStale(["K"], ["X"])).to.equal(true);
		expect(subscriptionIsStale(["K"], [undefined, "X"])).to.equal(true);
	});

	it("reads the stored keys from a Map's or an object's key iterator", () => {
		expect(subscriptionIsStale(Object.keys({K: 1}), new Map([["n", "X"]]).values())).to.equal(
			true
		);
	});
});
