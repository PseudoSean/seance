/**
 * Which writing systems each shipped locale's catalog may be written in.
 *
 * The sweep's third rule: a machine fill that answered in Devanagari for
 * Finnish, or in Greek for Afrikaans, is garbage however well-formed it
 * looks, and the script it is in is the cheapest way to see that. Latin is
 * allowed everywhere -- brand names, protocol words (IRC, SASL), the
 * {placeholder} names -- and so are the letters that carry no script of
 * their own, which is what NEUTRAL is for: U+30FC, the long vowel mark in
 * every other Japanese word, and U+0640, the Arabic tatweel, are letters
 * whose Script is Common. Script_Extensions rather than Script for the same
 * reason -- it is the set of scripts a character is USED in, which is the
 * question being asked here.
 */

const LATIN = /\p{Script_Extensions=Latin}/u;
const NEUTRAL = /[\p{Script=Common}\p{Script=Inherited}]/u;
const CYRILLIC = /\p{Script_Extensions=Cyrillic}/u;
const ARABIC = /\p{Script_Extensions=Arabic}/u;
const THAI = /\p{Script_Extensions=Thai}/u;
const HAN = /\p{Script_Extensions=Han}/u;
const HIRAGANA = /\p{Script_Extensions=Hiragana}/u;
const KATAKANA = /\p{Script_Extensions=Katakana}/u;
const HANGUL = /\p{Script_Extensions=Hangul}/u;

/** Latin and the script-less marks, plus whatever else the tag writes in. */
const writes = (...extra: RegExp[]): RegExp[] => [LATIN, NEUTRAL, ...extra];

/** The tags with no script of their own beyond Latin. */
const LATIN_TAGS = [
	"en",
	"de",
	"fr",
	"es",
	"it",
	"pt",
	"nl",
	"sv",
	"da",
	"pl",
	"cs",
	"sk",
	"hu",
	"ro",
	"tr",
	"vi",
	"fil",
];

export const EXPECTED_SCRIPTS: Record<string, RegExp[]> = {
	...Object.fromEntries(LATIN_TAGS.map((tag) => [tag, writes()])),
	ru: writes(CYRILLIC),
	uk: writes(CYRILLIC),
	ar: writes(ARABIC),
	th: writes(THAI),
	zh: writes(HAN),
	ja: writes(HAN, HIRAGANA, KATAKANA),
	ko: writes(HANGUL, HAN),
};
