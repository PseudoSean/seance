/**
 * The dial ledger (irc/dialLedger.ts): nefarious2's connection throttle
 * (IPcheck: the fourth connection in a chain of gaps of 40 s or less is
 * refused, and a refusal renews the window), replayed over this device's own
 * dials so the transport waits instead of dialing into a refusal.
 */

import {expect} from "chai";
import sinon from "ts-sinon";
import type {TransportOptions} from "../../client/js/irc/transport";
import {FakeTransport, register, setup} from "./support";
import {
	NEFARIOUS_RULE,
	dialGateFor,
	throttleWaitMs,
	useStorageBackend,
} from "../../client/js/irc/dialLedger";

const S = 1000;

describe("dial ledger (irc/dialLedger.ts)", function () {
	describe("throttleWaitMs", function () {
		it("lets the first dial through", function () {
			expect(throttleWaitMs([], 0, NEFARIOUS_RULE)).to.equal(0);
		});

		it("holds the fourth dial of a quick chain until the gap passes 40 s", function () {
			expect(throttleWaitMs([0, 10 * S, 20 * S], 30 * S, NEFARIOUS_RULE)).to.equal(32 * S);
		});

		it("lets the third dial of a chain through", function () {
			expect(throttleWaitMs([0, 10 * S], 20 * S, NEFARIOUS_RULE)).to.equal(0);
		});

		it("starts over after a gap of more than 40 s", function () {
			// 42 s: a whole second past the 40 s window on any phase, and the 1 s margin.
			expect(throttleWaitMs([0, 10 * S, 20 * S], 62 * S, NEFARIOUS_RULE)).to.equal(0);
		});

		it("counts refused dials, which renew the window", function () {
			expect(
				throttleWaitMs([0, 10 * S, 20 * S, 30 * S, 35 * S], 40 * S, NEFARIOUS_RULE)
			).to.equal(37 * S);
		});

		it("follows the rule's limit", function () {
			const rule = {...NEFARIOUS_RULE, limit: 2};
			expect(throttleWaitMs([0], 10 * S, rule)).to.equal(32 * S);
		});

		it("ignores events dated after now (a clock that ran ahead)", function () {
			const ahead = [3600 * S, 3610 * S, 3620 * S];
			expect(throttleWaitMs(ahead, 0, NEFARIOUS_RULE)).to.equal(0);
		});

		it("waits through the 41st second too, whatever its phase", function () {
			expect(throttleWaitMs([0, 10 * S, 20 * S], 60500, NEFARIOUS_RULE)).to.equal(1500);
			expect(throttleWaitMs([0, 10 * S, 20 * S], 61500, NEFARIOUS_RULE)).to.equal(500);
		});

		it("counts whole seconds, as the server does", function () {
			// 100.2 s and 140.7 s are 40 whole seconds apart on the server: one chain.
			expect(
				throttleWaitMs([100200, 140700, 141000], 142000, NEFARIOUS_RULE)
			).to.be.greaterThan(0);
		});

		it("restarts the gap when a connection closes (IPcheck's reset at the last disconnect)", function () {
			// Thirty seconds in, thirty out, three times: each gap since a close is 30 s.
			const dials = [0, 60 * S, 120 * S];
			const closes = [30 * S, 90 * S, 150 * S];
			expect(throttleWaitMs(dials, 180 * S, NEFARIOUS_RULE, closes)).to.equal(12 * S);
		});

		it("starts over when a close comes long after the chain", function () {
			const dials = [0, 10 * S, 20 * S];
			expect(throttleWaitMs(dials, 200 * S, NEFARIOUS_RULE, [190 * S])).to.equal(0);
		});

		it("does not care about the order dials were recorded in", function () {
			expect(throttleWaitMs([20 * S, 0, 10 * S], 30 * S, NEFARIOUS_RULE)).to.equal(32 * S);
		});

		describe("on a server that gives a login its attempt back (rule.refund)", function () {
			const rule = {...NEFARIOUS_RULE, refund: {limit: 10, periodMs: 600 * S}};

			it("does not grow the chain by a dial whose connection logged in", function () {
				// Three returns 30 s apart, each registered with SASL: the fourth gets in.
				const refunds = [1 * S, 31 * S, 61 * S];
				expect(throttleWaitMs([0, 30 * S, 60 * S], 90 * S, rule, [], refunds)).to.equal(0);
			});

			it("still counts the dials that did not log in", function () {
				expect(throttleWaitMs([0, 30 * S, 60 * S], 90 * S, rule, [], [1 * S])).to.equal(
					12 * S
				);
			});

			it("never takes the count below one, as the server does", function () {
				// Two refunds on the first dial change nothing: the chain still counts 3.
				expect(
					throttleWaitMs([0, 30 * S, 60 * S], 90 * S, rule, [], [1 * S, 2 * S])
				).to.equal(12 * S);
			});

			it("moves nothing but the count: the gap still runs from the last dial", function () {
				expect(
					throttleWaitMs([0, 30 * S, 60 * S], 90 * S, rule, [], [1 * S, 31 * S])
				).to.equal(0);
				// Without the second refund the fourth dial would wait.
				expect(throttleWaitMs([0, 30 * S, 60 * S], 90 * S, rule, [], [1 * S])).to.equal(
					12 * S
				);
			});

			it("mirrors the per-account cap: past `limit` refunds in a period the dials count again", function () {
				const capped = {...rule, refund: {limit: 2, periodMs: 600 * S}};
				const dials = [0, 30 * S, 60 * S, 90 * S];
				const refunds = [1 * S, 31 * S, 61 * S, 91 * S];
				// The third and fourth refunds are not honoured: the chain is 1, 1, 2, 3.
				expect(throttleWaitMs(dials, 120 * S, capped, [], refunds)).to.equal(12 * S);
				// A new period from the first refund: the budget is back.
				const later = [...dials, 601 * S];
				expect(throttleWaitMs(later, 630 * S, capped, [], [...refunds, 602 * S])).to.equal(
					0
				);
			});

			it("ignores refunds under a rule without them", function () {
				const refunds = [1 * S, 31 * S, 61 * S];
				expect(
					throttleWaitMs([0, 30 * S, 60 * S], 90 * S, NEFARIOUS_RULE, [], refunds)
				).to.equal(12 * S);
			});
		});
	});

	describe("dialGateFor", function () {
		let data: Map<string, string>;

		beforeEach(function () {
			data = new Map();
			useStorageBackend({
				get: (k) => data.get(k) ?? null,
				set: (k, v) => void data.set(k, v),
				remove: (k) => void data.delete(k),
			});
		});

		afterEach(function () {
			useStorageBackend(null);
		});

		it("records dials per host, whatever the case", function () {
			const a = dialGateFor("IRC.Example");
			const b = dialGateFor("irc.example");
			a.record(0);
			b.record(10 * S);
			a.record(20 * S);
			expect(b.waitMs(30 * S)).to.equal(32 * S);
			expect(dialGateFor("other.example").waitMs(30 * S)).to.equal(0);
		});

		it("keeps the record across instances (a reopened app)", function () {
			dialGateFor("irc.example").record(0);
			dialGateFor("irc.example").record(10 * S);
			dialGateFor("irc.example").record(20 * S);
			expect(dialGateFor("irc.example").waitMs(30 * S)).to.equal(32 * S);
		});

		it("prunes dials too old to matter", function () {
			const gate = dialGateFor("irc.example");
			gate.record(0);
			gate.record(1000 * S);
			const stored = JSON.parse(data.get("thelounge.state.dials") ?? "{}");
			expect(stored["irc.example"]).to.deep.equal({d: [1000 * S], c: [], r: []});
		});

		it("keeps the refunds it is told of, under a rule with them", function () {
			const rule = {...NEFARIOUS_RULE, refund: {limit: 10, periodMs: 600 * S}};
			const gate = dialGateFor("irc.example", rule);
			gate.record(0);
			gate.refunded(1 * S);
			gate.record(30 * S);
			gate.refunded(31 * S);
			gate.record(60 * S);
			gate.refunded(61 * S);
			expect(gate.waitMs(90 * S)).to.equal(0);
			const stored = JSON.parse(data.get("thelounge.state.dials") ?? "{}");
			expect(stored["irc.example"].r).to.deep.equal([1 * S, 31 * S, 61 * S]);
		});

		it("records no refund for a server that gives none", function () {
			const gate = dialGateFor("irc.example");
			gate.record(0);
			gate.refunded(1 * S);
			const stored = JSON.parse(data.get("thelounge.state.dials") ?? "{}");
			expect(stored["irc.example"]).to.deep.equal({d: [0], c: [], r: []});
		});

		it("keeps refunds for the refund period, which outlasts a chain", function () {
			const rule = {...NEFARIOUS_RULE, refund: {limit: 2, periodMs: 600 * S}};
			const gate = dialGateFor("irc.example", rule);
			gate.refunded(0);
			gate.record(300 * S);
			let stored = JSON.parse(data.get("thelounge.state.dials") ?? "{}");
			expect(stored["irc.example"].r).to.deep.equal([0]);
			gate.record(700 * S);
			stored = JSON.parse(data.get("thelounge.state.dials") ?? "{}");
			expect(stored["irc.example"].r).to.deep.equal([]);
		});

		it("ignores dials recorded in the future (a clock that ran ahead)", function () {
			const gate = dialGateFor("irc.example");
			gate.record(3600 * S);
			gate.record(3610 * S);
			gate.record(3620 * S);
			expect(gate.waitMs(0)).to.equal(0);
		});

		it("keeps the closes it is told of, with the dials", function () {
			const gate = dialGateFor("irc.example");
			gate.record(0);
			gate.closed(30 * S);
			gate.record(60 * S);
			gate.closed(90 * S);
			gate.record(120 * S);
			gate.closed(150 * S);
			expect(dialGateFor("irc.example").waitMs(180 * S)).to.equal(12 * S);
		});

		it("survives a broken record", function () {
			data.set("thelounge.state.dials", "{not json");
			expect(dialGateFor("irc.example").waitMs(0)).to.equal(0);
		});
	});

	describe("wired into the client", function () {
		let clock: sinon.SinonFakeTimers;

		beforeEach(function () {
			clock = sinon.useFakeTimers({now: Date.parse("2026-10-22T12:00:00.000Z")});
		});

		afterEach(function () {
			clock.restore();
		});

		/** The options the client builds its transport with. */
		let lastClient: ReturnType<typeof setup>["client"];

		function transportOptions(): TransportOptions {
			let captured: TransportOptions | undefined;
			const h = setup({
				transportFactory(opts) {
					captured = opts;
					return new FakeTransport();
				},
			});
			h.client.connect();
			lastClient = h.client;
			return captured as TransportOptions;
		}

		it("gives the transport a gate for the network's host", function () {
			expect(transportOptions().gate).to.not.equal(undefined);
		});

		it("does not record the drop of a session the bouncer holds (the server keeps it counted)", function () {
			const data = new Map<string, string>();
			useStorageBackend({
				get: (k) => data.get(k) ?? null,
				set: (k, v) => void data.set(k, v),
				remove: (k) => void data.delete(k),
			});
			const opts = transportOptions();

			const closes = (): number[] => {
				const all = JSON.parse(data.get("thelounge.state.dials") ?? "{}") as Record<
					string,
					{c?: number[]}
				>;
				return all["irc.test"]?.c ?? [];
			};

			const client = lastClient;
			client.persistenceHold = true;
			opts.gate!.closed(1000);
			expect(closes()).to.deep.equal([]);
			client.persistenceHold = false;
			opts.gate!.closed(2000);
			expect(closes()).to.deep.equal([2000]);
			useStorageBackend(null);
		});

		it("records the drop a page unload makes, for a session not held", function () {
			const data = new Map<string, string>();
			useStorageBackend({
				get: (k) => data.get(k) ?? null,
				set: (k, v) => void data.set(k, v),
				remove: (k) => void data.delete(k),
			});
			transportOptions();
			lastClient.noteUnload();
			const record = JSON.parse(data.get("thelounge.state.dials") ?? "{}")["irc.test"];
			expect(record?.c).to.deep.equal([Date.now()]);
			useStorageBackend(null);
		});

		it("records no unload drop for a held session, nor for a socket already gone", function () {
			const data = new Map<string, string>();
			useStorageBackend({
				get: (k) => data.get(k) ?? null,
				set: (k, v) => void data.set(k, v),
				remove: (k) => void data.delete(k),
			});
			transportOptions();
			lastClient.persistenceHold = true;
			lastClient.noteUnload();
			lastClient.persistenceHold = false;
			(lastClient.transport as FakeTransport).state = "closed";
			lastClient.noteUnload();
			const record = JSON.parse(data.get("thelounge.state.dials") ?? "{}")["irc.test"];
			expect(record?.c ?? []).to.deep.equal([]);
			useStorageBackend(null);
		});

		it("a KILL of our own connection ends the hold: a killed session is never held", function () {
			const h = setup();
			register(h);
			h.client.persistenceHold = true;
			h.transport.line(":oper!o@h KILL someone :irc.test!oper (spam)");
			expect(h.client.persistenceHold).to.equal(true);
			h.transport.line(":oper!o@h KILL alice :irc.test!oper (spam)");
			expect(h.client.persistenceHold).to.equal(false);
		});

		it("says a wait is the server's throttle, and drops that once the dial starts", function () {
			const h = setup();
			register(h);
			h.transport.event({
				type: "close",
				code: 1006,
				reason: "",
				wasClean: false,
				willReconnect: true,
				delayMs: 30_000,
			});
			h.transport.event({type: "reconnecting", attempt: 1, delayMs: 30_000, throttled: true});
			const status =
				h.payloads<{retryAt?: number; retryThrottled?: boolean}>("network:status");
			expect(status[status.length - 1]).to.include({
				retryAt: Date.now() + 30_000,
				retryThrottled: true,
			});
			expect(h.lastMessage(h.client.lobby.id).text).to.match(/limits how often/);

			h.transport.event({type: "retry", attempt: 1});
			const after = h.payloads<{retryThrottled?: boolean}>("network:status");
			expect(after[after.length - 1].retryThrottled).to.equal(undefined);
		});

		it("shows the due time of a throttled connect() that no close came before", function () {
			const h = setup();
			h.transport.event({type: "reconnecting", attempt: 0, delayMs: 20_000, throttled: true});
			const status =
				h.payloads<{retryAt?: number; retryThrottled?: boolean}>("network:status");
			expect(status[status.length - 1]).to.include({
				retryAt: Date.now() + 20_000,
				retryThrottled: true,
			});
		});

		it("keeps a plain backoff wait unmarked", function () {
			const h = setup();
			register(h);
			h.transport.event({
				type: "close",
				code: 1006,
				reason: "",
				wasClean: false,
				willReconnect: true,
				delayMs: 4_000,
			});
			h.transport.event({type: "reconnecting", attempt: 3, delayMs: 4_000});
			const status = h.payloads<{retryThrottled?: boolean}>("network:status");
			expect(status[status.length - 1].retryThrottled).to.equal(undefined);
		});
	});
});
