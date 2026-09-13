# Qwen3-1.7B re-scored on the web build's own weights (2026-09-13)

The user: "when you score the routers, use the same quant as the web version,
so it's accurate." `2026-09-12-languages.md` scored Qwen on
`onnx-community/Qwen3-1.7B-ONNX` q4f16, whose embedding and output head are
float16 -- not what a browser runs. These numbers come from the WebLLM model's
own q4f16_1 weights (`tools/translate-eval/mlc-to-onnx.py`: MLC's 4-bit groups
dequantized exactly, the tied 4-bit output head included), on the shipped
1.7B prompt (marks sentence scoped, 1881e957), through
`tools/translate-eval/roundtrip.ts` over `suite.json` (18 languages, 9 shapes
for the first eight, 3 for the rest) and `tmp/suite-rest.json` (29 languages,
3 shapes each). The suite ran on the CPU, the rest on the GPU (ONNX Runtime
CUDA with the model's layer norms in float32, which answers the prompts set
identically to the CPU run).

Each percentage is the content words found over the content words in the
English lines, summed over the language's cases (the same measure as
yesterday's table). NLLB and OPUS are yesterday's measurements, unchanged:
those engines run the same weights in the browser as offline. Three cases per
language outside the first eight: a difference under ~10 points is a tie.

| Language | Qwen (ONNX q4f16, 09-12) | Qwen (web weights) | NLLB (split) | OPUS | Placement now |
| --- | --- | --- | --- | --- | --- |
| de | 66% | 74% | 51% | 80% | Qwen = OPUS |
| fr | 75% | 66% | — | 63% | Qwen = OPUS (was Qwen, then OPUS) |
| es | 79% | 74% | — | 60% | Qwen, then OPUS |
| it | 72% | 76% | — | 63% | Qwen, then OPUS |
| pt | 80% | 75% | — | — | Qwen |
| nl | 77% | 81% | — | 88% | Qwen = OPUS |
| ru | 68% | 68% | — | 77% | Qwen = OPUS |
| ja | 61% | 68% | 45% | — | Qwen |
| zh | 70% | 73% | 65% | — | Qwen |
| pl | 56% | 69% | 56% | — | Qwen, then NLLB (was tie) |
| uk | 64% | 59% | — | — | Qwen |
| tr | 58% | 78% | — | — | Qwen |
| ko | 58% | 53% | — | — | Qwen, limited |
| sv | 62% | 66% | — | — | Qwen |
| cs | 53% | 63% | 61% | — | tie |
| ar | 55% | 38% | 67% | — | Qwen, then NLLB (kept by ruling: channel context) |
| hi | 50% | 25% | 49% | — | NLLB first (was tie), limited |
| vi | 77% | 81% | — | — | Qwen |
| id | 54% | 69% | 78% | — | tie (was NLLB first) |
| el | 8% | 19% | 77% | — | NLLB first |
| tl | 47% | 50% | 89% | — | NLLB first |
| da | 72% | 56% | — | — | Qwen |
| nb | 54% | 75% | 72% | — | tie (was NLLB first) |
| fi | 35% | 41% | 56% | — | NLLB first |
| sk | 56% | 44% | 51% | — | tie, limited |
| hu | 52% | 16% | 44% | — | NLLB first (was tie), limited |
| ro | 62% | 72% | — | — | Qwen |
| bg | 53% | 63% | 68% | — | tie (was NLLB first) |
| sr | 28% | 34% | 71% | — | NLLB first |
| hr | 55% | 31% | 77% | — | NLLB first |
| sl | 36% | 13% | 68% | — | NLLB first |
| he | 31% | 38% | 71% | — | NLLB first |
| fa | 45% | 16% | 62% | — | NLLB first |
| bn | 23% | 25% | 54% | — | NLLB first, limited |
| ta | 2% | 0% | 68% | — | NLLB first |
| th | 50% | 53% | 56% | — | tie |
| ms | 67% | 69% | 66% | — | tie |
| et | 13% | 0% | 49% | — | NLLB first, limited |
| lv | 9% | 31% | 43% | — | NLLB first, limited |
| lt | 9% | 3% | 54% | — | NLLB first, limited |
| ca | 34% | 72% | 61% | — | Qwen, then NLLB (was NLLB first) |
| eu | 11% | 6% | 57% | — | NLLB first |
| gl | 83% | 72% | 77% | — | tie |
| ga | 33% | 69% | 56% | — | Qwen, then NLLB (was NLLB first) |
| cy | 0% | 9% | 88% | — | NLLB first |
| is | 5% | 0% | 43% | — | NLLB first, limited |
| sw | 33% | 0% | 62% | — | NLLB first |
| af | 61% | 63% | 88% | — | NLLB first |
| ur | 33% | 0% | 66% | — | NLLB first |

## What changed in `routes.default.ts` (1.7B)

- **NLLB first:** hi (NLLB +24) and hu (+28) join; nb, bg and id move to a tie
  (within 10 points on the web weights), ca (Qwen +11) and ga (+13) move to
  Qwen first. ar stays Qwen first by the earlier ruling (the LLM reads the
  channel's context), although NLLB is ahead by 29 points on these lines.
- **Tie:** nb, bg, id join; hi and hu leave for NLLB first; pl (Qwen +13) leaves
  for Qwen first.
- **OPUS in one class with Qwen:** fr joins (Qwen +3, was +12).
- **Limited** (best engine under 55%): sk (51%) and ko (53%, Qwen only) join
  is, lv, et, hi, lt, bn, hu.

The long tail (et, is, sw, ur, ta, eu, lt, cy) comes back near zero from the
web 1.7B, lower than the ONNX build scored: the 4-bit output head costs most
where the model was already weakest, which is what NLLB first is for.

Qwen3-4B's placements are still a copy of these until its own round trip (on
its own 4-bit web weights, on the GPU) is scored.
