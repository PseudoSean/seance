/**
 * The prefs mirror (client/js/push-prefs.ts): the page's updates to the
 * worker's `prefs` entry run one at a time, so two started together (the
 * markdown setting and the mute list, at boot) both land.
 */
import {expect} from "chai";
import {afterEach, beforeEach, describe, it} from "mocha";
import {useIDBFactory} from "../../client/js/idb";
import {mirrorPushPrefs, PREFS_KEY} from "../../client/js/push-prefs";

type Req = {result?: unknown; onsuccess?: () => void; onupgradeneeded?: () => void};
type Tx = {objectStore(): unknown; oncomplete?: () => void};

describe("push prefs mirror (client/js/push-prefs.ts)", function () {
	let kv: Map<string, unknown>;

	beforeEach(function () {
		kv = new Map();
		// Every answer a turn later, as the real one fires.
		const later = (fn: () => void) => setTimeout(fn, 1);
		const store = {
			get(key: string) {
				const req: Req = {};
				later(() => {
					req.result = kv.get(key);
					req.onsuccess?.();
				});
				return req;
			},
			put(value: unknown, key: string) {
				later(() => kv.set(key, value));
				return {};
			},
		};
		const db = {
			createObjectStore: () => store,
			transaction() {
				const tx: Tx = {objectStore: () => store};
				later(() => later(() => tx.oncomplete?.()));
				return tx;
			},
			close() {},
		};
		useIDBFactory({
			open() {
				const req: Req = {};
				later(() => {
					req.result = db;
					req.onsuccess?.();
				});
				return req;
			},
		} as unknown as IDBFactory);
	});

	afterEach(function () {
		useIDBFactory(null);
	});

	it("keeps both of two updates started together", async function () {
		await Promise.all([
			mirrorPushPrefs({markdown: false}),
			mirrorPushPrefs({muted: ["net-1/#help"]}),
		]);

		expect(kv.get(PREFS_KEY)).to.deep.equal({markdown: false, muted: ["net-1/#help"]});
	});
});
