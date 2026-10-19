import {expect} from "chai";
import {
	formatDateTime,
	formatDayHeading,
	formatRelativeDay,
	formatRelativeTime,
	formatTime,
} from "../../../../client/js/i18n/dates";

describe("i18n date formatters", () => {
	// 12PM in UTC time
	const date = new Date("2014-05-22T12:00:00Z");

	// Offset between UTC and local timezone
	const offset = date.getTimezoneOffset() * 60 * 1000;

	// Pretend local timezone is UTC by moving the clock of that offset
	const time = date.getTime() + offset;

	it("should render the full timestamp in the active language", () => {
		const text = formatDateTime(time);
		// The exact en shape varies between ICU versions (", " vs " at "
		// before the time), so pin the parts the reader needs: day, month,
		// year and a seconds-carrying clock time.
		expect(text).to.contain("22");
		expect(text).to.contain("May");
		expect(text).to.contain("2014");
		expect(text).to.match(/\d{1,2}:\d{2}:\d{2}/);
	});

	it("should render the date-marker heading in the active language", () => {
		const text = formatDayHeading(time);
		expect(text).to.contain("22");
		expect(text).to.contain("May");
		expect(text).to.contain("2014");
	});

	it("should honour the hour12 setting on the timestamp cell", () => {
		// Explicit hour12: false forces the 24-hour clock ("12:00") even in
		// locales whose own preference is 12-hour; with seconds, the 12-hour
		// clock spells the day period.
		expect(formatTime(time, true, false)).to.equal("12:00:00");
		expect(formatTime(time, false, true)).to.match(/^12:00\s?PM$/);
	});

	it("should resolve Today and Yesterday through the passed-in t", () => {
		const t = (key: string) => `«${key}»`;
		expect(formatRelativeDay(Date.now(), t)).to.equal("«dates.today»");

		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		expect(formatRelativeDay(yesterday.getTime(), t)).to.equal("«dates.yesterday»");

		// Anything older falls back to the localized date heading.
		expect(formatRelativeDay(time, t)).to.equal(formatDayHeading(time));
	});

	it("should render relative time in the active language", () => {
		expect(formatRelativeTime(time)).to.match(/year/);
	});

	it("steps up from days to months and years, as dayjs's fromNow did", () => {
		const day = 86_400_000;
		expect(formatRelativeTime(Date.now() - 3 * day)).to.equal("3 days ago");
		expect(formatRelativeTime(Date.now() - 45 * day)).to.equal("last month");
		expect(formatRelativeTime(Date.now() - 100 * day)).to.equal("3 months ago");
		expect(formatRelativeTime(Date.now() - 400 * day)).to.equal("last year");
		expect(formatRelativeTime(Date.now() - 1000 * day)).to.equal("3 years ago");
	});
});
