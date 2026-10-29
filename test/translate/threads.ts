import {expect} from "chai";
import {DESKTOP_THREAD_CAP, cpuThreads, isolationState} from "../../client/js/translate/threads";

describe("translate threads", function () {
	describe("cpuThreads", function () {
		it("gives a phone at most 4 threads", function () {
			expect(cpuThreads(8, true)).to.equal(4);
			expect(cpuThreads(2, true)).to.equal(2);
		});

		it("leaves a computer's last core to the page, and never goes under one", function () {
			expect(cpuThreads(1, false)).to.equal(1);
			expect(cpuThreads(2, false)).to.equal(1);
			expect(cpuThreads(4, false)).to.equal(Math.min(3, DESKTOP_THREAD_CAP));
		});

		it("caps a big computer at the measured DESKTOP_THREAD_CAP", function () {
			expect(cpuThreads(56, false)).to.equal(DESKTOP_THREAD_CAP);
		});

		it("reads a missing or odd hardwareConcurrency as one core", function () {
			expect(cpuThreads(0, false)).to.equal(1);
			expect(cpuThreads(Number.NaN, true)).to.equal(1);
		});
	});

	describe("isolationState", function () {
		it("is isolated when the page is cross-origin isolated", function () {
			expect(
				isolationState({crossOriginIsolated: true, controlled: true, webkit: false})
			).to.equal("isolated");
		});

		it("asks for a reload on a page the worker did not serve yet", function () {
			expect(
				isolationState({crossOriginIsolated: false, controlled: false, webkit: false})
			).to.equal("reload");
		});

		it("is unsupported under WebKit, which has no credentialless", function () {
			expect(
				isolationState({crossOriginIsolated: false, controlled: false, webkit: true})
			).to.equal("unsupported");
		});

		it("is unsupported when the worker served the page and it is still not isolated", function () {
			expect(
				isolationState({crossOriginIsolated: false, controlled: true, webkit: false})
			).to.equal("unsupported");
		});
	});
});
