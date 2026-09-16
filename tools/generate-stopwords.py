#!/usr/bin/env python3
"""Generate client/js/translate/stopwords.json — the function-word tables the
short-line language classifier (client/js/translate/chatdetect.ts) matches
against. Generation-time only; committed output; rerun only when the language
list in client/js/i18n/targets.ts changes.

The output is keyed by the tags parsed from targets.ts (46 tags incl. en — en
is a legitimate source candidate, qqx does not exist there). Sources per tag,
in order:

  - wordfreq top_n_list(tag, CAP*2), but only when available_languages("best")
    lists the tag itself — wordfreq silently "nearest-matches" codes it lacks,
    which would poison tables, so a miss here means the next source;
  - stopwordsiso.stopwords(tag), with apostrophe-initial words and words
    containing digits dropped (list artifacts like "'ll" and "10");
  - HAND_CURATED below, for the few languages neither library serves.

Afterwards a word found in >= NOISE_TABLES tables is dropped everywhere: it
carries no cross-language signal ("in", "la"). Every emitted table must hold
at least MIN_TABLE words; anything thinner is a hard error, not written.
"""
import json, re, sys
from pathlib import Path

CAP = 60          # max words per table
NOISE_TABLES = 4  # a word in >= this many tables is dropped everywhere
MIN_TABLE = 10    # a table under this many words after noise-filtering fails

ROOT = Path(__file__).resolve().parent.parent
TARGETS = ROOT / "client/js/i18n/targets.ts"
OUT = ROOT / "client/js/translate/stopwords.json"

# hand-curated: function words for languages neither wordfreq ("best") nor
# stopwordsiso serve. Verbs/particles/articles/pronouns/conjunctions that
# dominate running text. te is kept for completeness even though Telugu is
# not currently a translation target, so it is never consulted.
HAND_CURATED = {
    "cy": [
        # article: y, yr — aspect/nominal particle: yn — perfective: wedi
        # negation: nid, ddim, na, nad, mai — copulas/verbs: mae, yw, oedd,
        # roedd, bod, sy, sydd — prepositions: i, o, ar, am, at, gan, gyda,
        # dros, dan, rhwng, er, fel — possessives: ei, eu, fy, dy, ein, eich
        # conjunctions: a, ac, ond, neu, os, pan — pronoun-ish/quantifiers:
        # hyn, hynny — adverbs: felly, hefyd — questions: beth, sut, pwy, ble
        "y", "yr", "yn", "wedi", "nid", "ddim", "na", "nad", "mai",
        "mae", "yw", "oedd", "roedd", "bod", "sy", "sydd",
        "i", "o", "ar", "am", "at", "gan", "gyda", "dros", "dan", "rhwng",
        "er", "fel", "ei", "eu", "fy", "dy", "ein", "eich",
        "a", "ac", "ond", "neu", "os", "pan", "hyn", "hynny",
        "felly", "hefyd", "beth", "sut", "pwy", "ble",
    ],
    "sr": [
        # Cyrillic and Latin mirrors of the same function words — either
        # script a line of Serbian may arrive in. Copulas/auxiliaries: је,
        # није, су, ће, би — reflexive: се — negation/interrogative: не, да,
        # шта, ко, где, када, како — pronouns: ја, ти, он, она, оно, они,
        # ово, то — prepositions: у, на, за, од, са — conjunctions: и, али,
        # или, па
        "је", "није", "су", "ће", "би", "да", "не", "се",
        "и", "у", "на", "за", "од", "са", "шта", "ко",
        "ја", "ти", "он", "она", "оно", "они", "ово", "то",
        "али", "или", "па", "где", "када", "како",
        "je", "nije", "su", "će", "bi", "da", "ne", "se",
        "i", "u", "na", "za", "od", "sa", "šta", "ko",
        "ja", "ti", "on", "ona", "ono", "oni", "ovo", "to",
        "ali", "ili", "pa", "gde", "kada", "kako",
    ],
    "te": [
        # pronouns: nēnu, nuvvu, mīru, mēmu, manaṁ, vāru, atanu, āme —
        # demonstratives: adi, idi, avi, ivi, ī, ā, oka — copulas/verbs:
        # undi, unnāyi, uṁṭundi, kādu, lēdu — conjunctions: mariyu, lēdā,
        # kānī, ayitē — postpositions: tō, ki, ku, lō, nuṁḍi, varaku,
        # kōsaṁ, gurin̄ci, cēta, vadda — focus: kūḍā — questions: ēmi, ēvaru,
        # ekkada, eppuḍu, ēlā, ēṁduku — time/place: ippuḍu, ikkaḍa
        "నేను", "నువ్వు", "మీరు", "మేము", "మనం", "వారు", "అతను", "ఆమె",
        "అది", "ఇది", "అవి", "ఇవి", "ఈ", "ఆ", "ఒక",
        "ఉంది", "ఉన్నాయి", "ఉంటుంది", "కాదు", "లేదు",
        "మరియు", "లేదా", "కానీ", "అయితే",
        "తో", "కి", "కు", "లో", "నుండి", "వరకు", "కోసం", "గురించి",
        "చేత", "వద్ద", "కూడా",
        "ఏమి", "ఎవరు", "ఎక్కడ", "ఎప్పుడు", "ఎలా", "ఎందుకు",
        "ఇప్పుడు", "ఇక్కడ",
    ],
}


def target_tags() -> list[str]:
    """The tags of targets.ts — the source of truth for the output keys."""
    tags = re.findall(r'"tag":\s*"([^"]+)"', TARGETS.read_text(encoding="utf-8"))
    if not tags:
        sys.exit(f"no tags parsed from {TARGETS}")
    return tags


def clean(words) -> list[str]:
    """Lowercase, strip, deduplicate, cap at CAP, preserving order."""
    seen: set[str] = set()
    out: list[str] = []
    for w in words:
        w = w.strip().lower()
        if w and w not in seen and w.isprintable():
            seen.add(w)
            out.append(w)
        if len(out) >= CAP:
            break
    return out


def main() -> None:
    from wordfreq import available_languages, top_n_list
    import stopwordsiso as stopwords

    wf = set(available_languages("best"))
    tags = target_tags()
    tables: dict[str, list[str]] = {}
    nosource: list[str] = []
    for tag in tags:
        if tag in wf:
            words = clean(top_n_list(tag, CAP * 2))
        else:
            raw = [w for w in sorted(stopwords.stopwords(tag))
                   if not w.startswith("'") and not any(c.isdigit() for c in w)]
            words = clean(raw)
            if not words:
                if tag not in HAND_CURATED:
                    nosource.append(tag)
                    continue
                words = clean(HAND_CURATED[tag])
        tables[tag] = words
    if nosource:
        sys.exit(f"no source for target tag(s): {', '.join(sorted(nosource))}")

    # Cross-language noise: a word in >=4 tables carries no signal ("in", "la").
    counts: dict[str, int] = {}
    for words in tables.values():
        for w in set(words):
            counts[w] = counts.get(w, 0) + 1
    noisy = {w for w, n in counts.items() if n >= NOISE_TABLES}
    for tag, words in tables.items():
        tables[tag] = [w for w in words if w not in noisy]

    under = sorted((t, len(w)) for t, w in tables.items() if len(w) < MIN_TABLE)
    if under:
        listing = ", ".join(f"{t} ({n})" for t, n in under)
        sys.exit(f"tables under {MIN_TABLE} words after noise filtering: {listing}")

    OUT.write_text(json.dumps(tables, ensure_ascii=False, sort_keys=True, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {len(tables)} languages)")


if __name__ == "__main__":
    main()
