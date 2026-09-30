// Vue-free Intl formatters, memoized per tag+options. hour12 comes from the
// use12hClock setting (already locale-seeded — helpers/hourCycle.ts). The
// cache keys carry the tag, so a locale change takes effect on the next
// call — the first format under a tag builds that tag's formatters.
//
// This directory is skipped by tools/i18n/check.ts's call-site scan: date
// PATTERNS are Intl's business, not the catalog's. The only catalog keys
// here are the Today/Yesterday labels, resolved through the t() the caller
// passes (DateMarker.vue owns them).

import {activeLocale} from "./core";

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, build: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
	let fmt = cache.get(key);

	if (!fmt) {
		fmt = build();
		cache.set(key, fmt);
	}

	return fmt;
}

const relativeCache = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormatter(tag: string): Intl.RelativeTimeFormat {
	let rtf = relativeCache.get(tag);

	if (!rtf) {
		rtf = new Intl.RelativeTimeFormat(tag, {numeric: "auto"});
		relativeCache.set(tag, rtf);
	}

	return rtf;
}

/** Message timestamp cell: "15:04" (or with seconds; hour cycle per setting). */
export function formatTime(ms: number, showSeconds: boolean, hour12?: boolean): string {
	const tag = activeLocale();
	return formatter(
		`time-${tag}-${String(showSeconds)}-${String(hour12)}`,
		() =>
			new Intl.DateTimeFormat(tag, {
				hour: "numeric",
				minute: "2-digit",
				...(showSeconds ? {second: "2-digit"} : {}),
				...(hour12 === undefined ? {} : {hour12}),
			})
	).format(ms);
}

/** Date-marker heading: "4 February 2026" in the active language. */
export function formatDayHeading(ms: number): string {
	const tag = activeLocale();
	return formatter(
		`day-${tag}`,
		() => new Intl.DateTimeFormat(tag, {day: "numeric", month: "long", year: "numeric"})
	).format(ms);
}

/** Date-marker tooltip: Today / Yesterday / the date (t = core t). */
export function formatRelativeDay(ms: number, t: (key: string) => string): string {
	const toDay = (d: Date) =>
		Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000);
	const diff = toDay(new Date()) - toDay(new Date(ms));

	if (diff === 0) {
		return t("dates.today");
	}

	if (diff === 1) {
		return t("dates.yesterday");
	}

	return formatDayHeading(ms);
}

/** Full timestamp, date and time with seconds — the shape of the dayjs
 * localetime helper this module replaces (tooltips, ban lists, whois). */
export function formatDateTime(at: number | Date, hour12?: boolean): string {
	const tag = activeLocale();
	const ms = at instanceof Date ? at.getTime() : at;
	return formatter(
		`datetime-${tag}-${String(hour12)}`,
		() =>
			new Intl.DateTimeFormat(tag, {
				day: "numeric",
				month: "long",
				year: "numeric",
				hour: "numeric",
				minute: "2-digit",
				second: "2-digit",
				...(hour12 === undefined ? {} : {hour12}),
			})
	).format(ms);
}

/** Relative time, "5 minutes ago" in the active language — the Mentions
 * popup's dayjs fromNow() replacement. */
export function formatRelativeTime(ms: number): string {
	const rtf = relativeFormatter(activeLocale());
	const seconds = Math.round((ms - Date.now()) / 1000);

	if (Math.abs(seconds) < 60) {
		return rtf.format(seconds, "second");
	}

	const minutes = Math.round(seconds / 60);

	if (Math.abs(minutes) < 60) {
		return rtf.format(minutes, "minute");
	}

	const hours = Math.round(minutes / 60);

	if (Math.abs(hours) < 24) {
		return rtf.format(hours, "hour");
	}

	return rtf.format(Math.round(hours / 24), "day");
}
