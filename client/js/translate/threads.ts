/**
 * Threads for the CPU models (docs/projects/translation-devices.md
 * § Multithreading). Multithreaded WebAssembly needs a cross-origin-isolated
 * page; the app's root service worker supplies the headers
 * (client/service-worker.js `isolate`), so a page is isolated from the load
 * after the worker took control of it. Vue-free, DOM-free: the worker and
 * the page each pass in what they read.
 */

/**
 * The most threads the CPU language model takes on a computer: past this
 * count a doubling gained under 15 % on the composer prompt, measured on
 * this project's host (tools/translate-eval/results/2026-10-29-cpu-llm.md
 * § Threads).
 */
export const DESKTOP_THREAD_CAP = 8;

/** A phone's cap: past its big cores, the little ones hold every barrier back. */
export const PHONE_THREAD_CAP = 4;

/**
 * Threads for the CPU language model on a device with `hardwareConcurrency`
 * logical cores: on a phone at most `PHONE_THREAD_CAP`, on a computer one
 * core left to the page and at most `DESKTOP_THREAD_CAP`. Never under one;
 * a missing or odd count is one core.
 */
export function cpuThreads(hardwareConcurrency: number, mobile: boolean): number {
	const cores =
		Number.isFinite(hardwareConcurrency) && hardwareConcurrency >= 1
			? Math.floor(hardwareConcurrency)
			: 1;

	return mobile
		? Math.min(PHONE_THREAD_CAP, cores)
		: Math.min(DESKTOP_THREAD_CAP, Math.max(1, cores - 1));
}

/**
 * Whether this page can run the CPU models multithreaded: "isolated" it
 * does; "reload" the next load will (the worker did not serve this page);
 * "unsupported" it never will here (WebKit has no `credentialless`, or the
 * worker served the page and it is still not isolated).
 */
export type Isolation = "isolated" | "reload" | "unsupported";

export interface IsolationEnv {
	/** `self.crossOriginIsolated` of the page. */
	crossOriginIsolated: boolean;
	/**
	 * Whether the service worker served **this document**, not whether one
	 * controls the page now: the root worker `clients.claim()`s a page on
	 * its first visit, so `navigator.serviceWorker.controller` is set on a
	 * page the worker never served, and that page needs the reload. Read
	 * it from the navigation's timing (`PerformanceNavigationTiming`
	 * `workerStart > 0`), or from the controller as it stood at boot
	 * before the worker could claim the page.
	 */
	controlled: boolean;
	/** WebKit (Safari, every iOS browser): no COEP `credentialless`. */
	webkit: boolean;
}

export function isolationState(env: IsolationEnv): Isolation {
	if (env.crossOriginIsolated) {
		return "isolated";
	}

	return !env.controlled && !env.webkit ? "reload" : "unsupported";
}
