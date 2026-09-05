import {expect} from "chai";
import {
	decodeApplicationServerKey,
	keyChangePolicy,
	sameApplicationServerKey,
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

describe("pushKeys — keyChangePolicy", () => {
	it("passes the three known policies through", () => {
		expect(keyChangePolicy("ask")).to.equal("ask");
		expect(keyChangePolicy("trust")).to.equal("trust");
		expect(keyChangePolicy("ignore")).to.equal("ignore");
	});

	it("reads anything else as ask (the default; an unknown value must not silence the prompt)", () => {
		expect(keyChangePolicy(undefined)).to.equal("ask");
		expect(keyChangePolicy("")).to.equal("ask");
		expect(keyChangePolicy("never")).to.equal("ask");
		expect(keyChangePolicy(true)).to.equal("ask");
	});
});
