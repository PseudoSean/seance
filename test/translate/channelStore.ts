import {expect} from "chai";
import {
	STORAGE_KEY,
	TERM_CAP,
	channelKey,
	defaultChannelTranslation,
	forgetChannel,
	forgetNetwork,
	getChannelTranslation,
	loadAll,
	rememberTerm,
	setChannelTranslation,
	splitKey,
	useStorageBackend,
	type ChannelTranslation,
} from "../../client/js/translate/channelStore";

function memoryBackend() {
	const data = new Map<string, string>();

	return {
		data,
		get(key: string) {
			return data.get(key) ?? null;
		},
		set(key: string, value: string) {
			data.set(key, value);
		},
		remove(key: string) {
			data.delete(key);
		},
	};
}

describe("translate/channelStore", () => {
	let backend = memoryBackend();

	beforeEach(() => {
		backend = memoryBackend();
		useStorageBackend(backend);
	});

	afterEach(() => useStorageBackend(null));

	it("keys are network uuid and lower-cased channel name", () => {
		expect(channelKey("n1", "#Seance")).to.equal("n1/#seance");
		expect(splitKey("n1/#seance")).to.deep.equal({network: "n1", name: "#seance"});
	});

	it("an unknown channel is off with the defaults", () => {
		expect(getChannelTranslation("n1", "#seance")).to.deep.equal(defaultChannelTranslation());
		expect(defaultChannelTranslation()).to.deep.equal({
			read: null,
			write: null,
			formality: "auto",
			variant: "",
			languages: [],
			since: 0,
			terms: [],
		});
	});

	it("the channel's languages are kept, deduplicated, unknown codes dropped", () => {
		expect(
			setChannelTranslation("n1", "#seance", {languages: ["de", "en", "de", "xx", "nb"]})
				.languages
		).to.deep.equal(["de", "en", "nb"]);
		expect(getChannelTranslation("n1", "#seance").languages).to.deep.equal(["de", "en", "nb"]);

		// A patch that does not mention them leaves them alone.
		expect(setChannelTranslation("n1", "#seance", {read: "en"}).languages).to.deep.equal([
			"de",
			"en",
			"nb",
		]);
		expect(setChannelTranslation("n1", "#seance", {languages: []}).languages).to.deep.equal([]);
	});

	it("sanitize drops languages this build cannot route", () => {
		backend.set(
			STORAGE_KEY,
			JSON.stringify({
				"n1/#a": {read: "en", languages: ["de", "zz", 7, "de"]},
				"n1/#b": {read: "en", languages: "de"},
			})
		);

		const all = loadAll();

		expect(all["n1/#a"].languages).to.deep.equal(["de"]);
		expect(all["n1/#b"].languages).to.deep.equal([]);
	});

	it("switching reading on records the moment, and persists", () => {
		const before = Date.now();
		const state = setChannelTranslation("n1", "#Seance", {read: "en"});

		expect(state.read).to.equal("en");
		expect(state.since).to.be.at.least(before);
		expect(JSON.parse(backend.data.get(STORAGE_KEY) as string)["n1/#seance"].read).to.equal(
			"en"
		);
		expect(getChannelTranslation("n1", "#seance").read).to.equal("en");
	});

	it("changing the language while on keeps the moment; switching off clears it", () => {
		const first = setChannelTranslation("n1", "#seance", {read: "en"}).since;

		expect(setChannelTranslation("n1", "#seance", {read: "de"}).since).to.equal(first);
		expect(setChannelTranslation("n1", "#seance", {read: null}).since).to.equal(0);
	});

	it("term memory dedupes by source, keeps the newest, and is capped", () => {
		rememberTerm("n1", "#seance", ["rig", "Testaufbau"]);
		rememberTerm("n1", "#seance", ["rig", "Prüfstand"]);
		expect(getChannelTranslation("n1", "#seance").terms).to.deep.equal([["rig", "Prüfstand"]]);

		for (let i = 0; i < TERM_CAP + 5; i++) {
			rememberTerm("n1", "#seance", [`t${i}`, `x${i}`]);
		}

		const terms = getChannelTranslation("n1", "#seance").terms;

		expect(terms.length).to.equal(TERM_CAP);
		expect(terms[terms.length - 1]).to.deep.equal([`t${TERM_CAP + 4}`, `x${TERM_CAP + 4}`]);
		expect(terms.some(([source]) => source === "rig")).to.equal(false);
	});

	it("forgetting a channel or a network removes its entries", () => {
		setChannelTranslation("n1", "#a", {read: "en"});
		setChannelTranslation("n1", "#b", {read: "en"});
		setChannelTranslation("n2", "#a", {read: "en"});
		forgetChannel("n1", "#A");
		expect(Object.keys(loadAll())).to.deep.equal(["n1/#b", "n2/#a"]);
		forgetNetwork("n1");
		expect(Object.keys(loadAll())).to.deep.equal(["n2/#a"]);
	});

	it("survives unreadable storage", () => {
		backend.set(STORAGE_KEY, "nonsense");
		expect(loadAll()).to.deep.equal({});
		backend.set(STORAGE_KEY, JSON.stringify({"n1/#a": {read: 7, terms: "x"}, "n1/#b": null}));
		expect(loadAll()).to.deep.equal({"n1/#a": defaultChannelTranslation()});
	});

	it("drops a stored target this build cannot route", () => {
		backend.set(
			STORAGE_KEY,
			JSON.stringify({
				"n1/#a": {read: "xx", write: "zz", since: 1234, variant: "keep me"},
				"n1/#b": {read: "de", write: "en", since: 1234},
			})
		);

		const all = loadAll();

		expect(all["n1/#a"].read).to.equal(null);
		expect(all["n1/#a"].write).to.equal(null);
		// `since` goes with an unusable read, the rest of the record stays.
		expect(all["n1/#a"].since).to.equal(0);
		expect(all["n1/#a"].variant).to.equal("keep me");
		expect(all["n1/#b"].read).to.equal("de");
		expect(all["n1/#b"].write).to.equal("en");
		expect(all["n1/#b"].since).to.equal(1234);
	});

	it("a patch cannot overwrite the term memory or the moment", () => {
		setChannelTranslation("n1", "#seance", {read: "en"});
		rememberTerm("n1", "#seance", ["rig", "Testaufbau"]);
		const before = getChannelTranslation("n1", "#seance");
		const next = setChannelTranslation("n1", "#seance", {
			...before,
			read: "de",
			terms: [],
			since: 1,
		} as Partial<Omit<ChannelTranslation, "since" | "terms">>);

		expect(next.terms).to.deep.equal([["rig", "Testaufbau"]]);
		expect(next.since).to.equal(before.since);
	});
});
