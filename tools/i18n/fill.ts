/* eslint-disable no-console */
// Fill the empty msgstr entries of client/locales/<tag>.po using the engine
// the route table places best for each language (Step 3 of the localization/
// translation phase). The model selection follows
// client/js/translate/routes.default.ts exactly as the app routes: NLLB-first
// and NLLB-tied languages go to NLLB, OPUS-tied ones to their OPUS-MT pair
// (both CPU seq2seq, fast), and the rest to the GPU LLM (which needs a
// converted, CUDA-safe model dir — tools/translate-eval/norm-fp32.py).
//
//   npx tsx tools/i18n/fill.ts [--langs de,fr,...] [--engine llm|nllb|opus]
//       [--force-engine llm|nllb|opus] [--repo <converted model dir>]
//       [--model-id Qwen3-4B-q4f16_1-MLC] [--device cuda|cpu] [--batch 20]
//       [--limit N] [--dry]
//
// `--engine` SCOPES the run to the languages the route table already places
// on that engine; `--force-engine` puts every language in the run ON it,
// whatever the table says. The table is the app's measured runtime routing,
// where a request is one chat line under a latency budget; a catalog is
// filled once, offline, and the better engine wins — the 4B LLM writes
// Russian the OPUS-MT pair answers degenerately.
//
// The unit of work is a msgstr SLOT: a singular entry has one, a plural
// entry one per gettext form — the slot n = 1 reads translates msgid, the
// rest translate msgid_plural, and a one-form language's single slot takes
// the plural text (tools/i18n/plural.ts planPluralSlots). Each
// slot's source text is protected (spans.ts, the marker form the engine's
// route asks for) before the request and restored after; a translation that
// does not keep all of the original's placeholders is left empty. The .po is
// rewritten after every batch, so a run can be interrupted and resumed —
// filled slots are skipped on the next pass.

import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {emptyContext, TranslateRequest} from "../../client/js/translate/engine";
import {QWEN3_4B_ID} from "../../client/js/translate/models";
import {nllbCode} from "../../client/js/translate/languages";
import {promptProfileFor} from "../../client/js/translate/prompts";
import {placementFor} from "../../client/js/translate/routes.default";
import {placeholdersIn, protect, restoreAll} from "../../client/js/translate/spans";
import {parseBatchedOutput} from "../../client/js/translate/prompt";
import {WebLlmEngine} from "../../client/js/translate/engines/webllm";
import {parsePo, PoEntry, serializePo} from "./po";
import {PLURAL_RULES, parsePluralForms, planPluralSlots} from "./plural";
import {slotVerdict} from "./quality";
import {NAME_TO_TAG, TARGETS_SOURCE} from "./targets";

type EngineName = "llm" | "nllb" | "opus";

/** One msgstr slot to fill and the English text that fills it. */
interface Unit {
	entry: PoEntry;
	/** The msgstr[N] index this translation is written to. */
	slot: number;
	/** msgid for a singular entry and for a plural's n = 1 slot; msgid_plural otherwise. */
	text: string;
}

const LOCALES = resolve("client/locales");
const NLLB_MODEL = "Xenova/nllb-200-distilled-600M";
const SRC_NLLB = "eng_Latn";
const BATCH_NLLB = 16;
const BATCH_LLM = 20;

// A catalog placeholder is not chat text, so spans.ts does not protect it —
// and an engine handed a bare `{network}` translates the word inside it
// ("{тип}"), which the placeholder gate then refuses, so the slot stays
// empty. Fencing each one as a code span before the protection hands it to
// the same machinery every URL and nick goes through: the engine only ever
// sees a numbered marker, and the restore brings the placeholder back
// character for character. No msgid carries a backtick of its own.
const BRACE_RX = /\{[^{}\s]*\}/g;

export function fenceBraces(text: string): string {
	return text.replace(BRACE_RX, (match) => "`" + match + "`");
}

export function unfenceBraces(text: string): string {
	return text.replace(/`(\{[^{}\s]*\})`/g, "$1");
}

// The seq2seq models do not carry ⟦n⟧: measured on Xenova/opus-mt-en-de,
// "Connecting to ⟦1⟧" comes back "Verbindung zu ,1," — the brackets are not
// in the Marian vocabulary and the restore then has nothing to put the span
// back into, so every protected slot failed. `<n>` survives every engine
// tested, so the seq2seq routes see that form and the answer is mapped back
// before the marker gate and the restore, which both speak ⟦n⟧.
export function toTags(text: string): string {
	return text.replace(/⟦\s*(\d+)\s*⟧/g, "<$1>");
}

export function fromTags(text: string): string {
	return text.replace(/<\s*(\d+)\s*>/g, "⟦$1⟧");
}

function engineFor(tag: string): EngineName {
	const placement = placementFor(QWEN3_4B_ID);

	if (placement.nllbFirst.includes(tag) || placement.nllbTied.includes(tag)) {
		return "nllb";
	}

	if (placement.opusTied.includes(tag)) {
		return "opus";
	}

	return "llm";
}

interface Options {
	langs: string[] | null;
	engine: EngineName | null;
	/** Every language in the run goes to this engine, route table or not. */
	forceEngine: EngineName | null;
	repo: string | null;
	modelId: string;
	device: "cpu" | "cuda";
	batch: number;
	limit: number | null;
	dry: boolean;
}

function parseArgs(argv: string[]): Options {
	const options: Options = {
		langs: null,
		engine: null,
		forceEngine: null,
		repo: null,
		modelId: QWEN3_4B_ID,
		device: "cuda",
		batch: BATCH_LLM,
		limit: null,
		dry: false,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];

		if (arg === "--langs") {
			options.langs = (argv[++i] ?? "")
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		} else if (arg === "--engine") {
			options.engine = argv[++i] as EngineName;
		} else if (arg === "--force-engine") {
			options.forceEngine = argv[++i] as EngineName;
		} else if (arg === "--repo") {
			options.repo = resolve(argv[++i] ?? "");
		} else if (arg === "--model-id") {
			options.modelId = argv[++i] ?? options.modelId;
		} else if (arg === "--device") {
			options.device = (argv[++i] as Options["device"]) ?? options.device;
		} else if (arg === "--batch") {
			options.batch = Number(argv[++i] ?? options.batch);
		} else if (arg === "--limit") {
			options.limit = Number(argv[++i] ?? "");
		} else if (arg === "--dry") {
			options.dry = true;
		}
	}

	return options;
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const names = readFileSync(TARGETS_SOURCE, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"));
	const allTags = names.map((name) => NAME_TO_TAG[name]).filter(Boolean);
	const langs = (options.langs ?? allTags).map((lang) => NAME_TO_TAG[lang] ?? lang);

	// The route table's placement decides the engine — --engine only scopes
	// the run to the languages the route table sends to that engine.
	const plan: {tag: string; engine: EngineName}[] = [];

	for (const tag of langs) {
		const placed = engineFor(tag);

		if (options.forceEngine) {
			plan.push({tag, engine: options.forceEngine});
			continue;
		}

		if (!options.engine || options.engine === placed) {
			plan.push({tag, engine: placed});
		}
	}

	if (options.dry) {
		for (const {tag, engine} of plan) {
			console.log(`${tag}: ${engine}`);
		}

		return;
	}

	const {pipeline} = await import("@huggingface/transformers");
	const {env} = await import("@huggingface/transformers");
	env.cacheDir = resolve("tmp", "models");

	let nllbPipe: Awaited<ReturnType<typeof pipeline>> | null = null;
	const opusPipes = new Map<string, Awaited<ReturnType<typeof pipeline>>>();

	let llmEngine: WebLlmEngine | null = null;

	if (plan.some(({engine}) => engine === "llm")) {
		if (!options.repo || !existsSync(options.repo)) {
			console.error(
				"fill: the LLM languages need a converted, CUDA-safe model dir " +
					"(tools/translate-eval/norm-fp32.py) — pass --repo. Skipping them."
			);
		} else {
			const {buildCatalog} = await import("../../client/js/translate/models");
			const {nodeDeps} = await import("../llm-node-backend");
			const catalog = buildCatalog({}, options.modelId);
			const {deps} = nodeDeps(options.modelId, {
				device: options.device,
				repo: options.repo,
				dtype: "q4f16",
				threads: null,
				log: (text) => console.log(text),
			});
			deps.promptProfileFor = () => promptProfileFor(options.modelId);
			llmEngine = new WebLlmEngine(deps, (code) => code);
			llmEngine.configure(catalog);

			console.log("fill: loading the converted 4B weights…");
			let shown = -1;
			await llmEngine.load(catalog.llm, (progress) => {
				const percent = Math.floor(progress.fraction * 100);

				if (percent >= shown + 10 || percent === 100) {
					shown = percent;
					console.log(`  load ${percent}% ${progress.text ?? ""}`.trimEnd());
				}
			});
		}
	}

	let totalFilled = 0;
	let totalFailed = 0;

	for (const {tag, engine} of plan) {
		const poPath = resolve(LOCALES, `${tag}.po`);

		if (!existsSync(poPath)) {
			console.warn(`fill: ${tag}.po missing — run tools/i18n/scaffold.ts first`);
			continue;
		}

		if (engine === "llm" && !llmEngine) {
			console.log(`fill: ${tag} — skipped (no converted LLM model dir)`);
			continue;
		}

		const po = parsePo(readFileSync(poPath, "utf8"));
		const rule = PLURAL_RULES[tag] ?? parsePluralForms(po.headers["plural-forms"] ?? "");

		if (!rule) {
			console.warn(
				`fill: no plural rule for ${tag} — add it to tools/i18n/plural-rules.json`
			);
			continue;
		}

		// The unit of work is a msgstr SLOT, not an entry: a plural entry
		// carries one slot per gettext form, the slot n = 1 reads translates
		// msgid and every other one translates msgid_plural. Filling only the
		// first slot left the rest empty, and the compile then drops the whole
		// key (or, before that ruling, served the singular for every count).
		const todo: Unit[] = [];

		for (const entry of po.entries) {
			// An empty msgid is a deliberately blank slot (the deploy fills
			// it); translating "" only invents text, so it never enters the
			// todo.
			if (!entry.msgid) {
				continue;
			}

			if (entry.msgidPlural === undefined) {
				if (!entry.msgstr[0]) {
					todo.push({entry, slot: 0, text: entry.msgid});
				}

				continue;
			}

			while (entry.msgstr.length < rule.nplurals) {
				entry.msgstr.push("");
			}

			for (const {index, source} of planPluralSlots(entry, rule.nplurals, rule.expr)) {
				if (!entry.msgstr[index]) {
					todo.push({
						entry,
						slot: index,
						text: source === "msgid" ? entry.msgid : entry.msgidPlural,
					});
				}
			}
		}

		if (todo.length === 0) {
			console.log(`fill: ${tag} — already complete`);
			continue;
		}

		const limited = options.limit ? todo.slice(0, options.limit) : todo;
		const started = Date.now();
		let filled = 0;
		let failed = 0;

		const flush = () =>
			writeFileSync(poPath, serializePo(po.headers, po.entries, po.headerOrder));

		if (engine === "nllb" && !nllbPipe) {
			console.log("fill: loading NLLB-200 (600M)…");
			nllbPipe = (await (pipeline as any)("translation", NLLB_MODEL)) as any;
		}

		if (engine === "opus") {
			const modelId = `Xenova/opus-mt-en-${tag}`;

			if (!opusPipes.has(modelId)) {
				console.log(`fill: loading ${modelId}…`);
				opusPipes.set(modelId, (await (pipeline as any)("translation", modelId)) as any);
			}
		}

		const batches: typeof limited[] = [];

		for (let i = 0; i < limited.length; i += engine === "llm" ? options.batch : BATCH_NLLB) {
			batches.push(limited.slice(i, i + (engine === "llm" ? options.batch : BATCH_NLLB)));
		}

		for (const batch of batches) {
			// One protection per entry, in the marker form the engine's route
			// asks for (spans.ts): numbered tags for the seq2seq engines,
			// placeholders for the LLM.
			const markerForm = engine === "llm" ? "placeholder" : "tags";
			const protectedEntries = batch.map((unit) => ({
				unit,
				...protect(fenceBraces(unit.text), {nicks: [], markers: markerForm}),
			}));

			try {
				let outputs: (string | null)[] = [];

				if (engine === "nllb") {
					const tgt = nllbCode(tag) ?? tag;
					const results = await (nllbPipe as any)(
						protectedEntries.map((p) => toTags(p.text)),
						{src_lang: SRC_NLLB, tgt_lang: tgt}
					);
					outputs = (results as Array<{translation_text?: string} | null>).map((r) =>
						typeof r?.translation_text === "string"
							? fromTags(r.translation_text)
							: null
					);
				} else if (engine === "opus") {
					const pipe = opusPipes.get(`Xenova/opus-mt-en-${tag}`);
					const results = await (
						pipe as unknown as (
							texts: string[]
						) => Promise<Array<{translation_text?: string}>>
					)(protectedEntries.map((p) => toTags(p.text)));
					outputs = results.map((r) =>
						typeof r?.translation_text === "string"
							? fromTags(r.translation_text)
							: null
					);
				} else {
					const request: TranslateRequest = {
						id: 1,
						model: options.modelId,
						text: "",
						lines: protectedEntries.map((p) => p.text),
						from: "en",
						to: tag,
						purpose: "read",
						context: emptyContext(),
						markers: "placeholder",
					};

					let last = "";

					for await (const chunk of llmEngine!.translate(
						request,
						new AbortController().signal
					)) {
						last = chunk.text;
					}

					const parsed = parseBatchedOutput(last, batch.length);
					outputs = parsed ?? batch.map(() => null);
				}

				batch.forEach((unit, index) => {
					const info = protectedEntries[index];
					const raw = outputs[index];

					if (typeof raw !== "string") {
						failed += 1;
						return;
					}

					// Two gates: the model must carry every protection marker
					// it was given (⟦n⟧ / <n>), and after the restore the
					// {placeholder} braces of the original must survive — a
					// renamed one breaks the label at render time, and the
					// compile refuses the whole catalog for it.
					const markersGiven = placeholdersIn(info.text).join("|");
					const markersBack = placeholdersIn(raw).join("|");

					if (markersGiven !== markersBack) {
						failed += 1;
						console.warn(
							`fill: ${tag} "${unit.text}" lost a protection marker (${markersGiven} → ${markersBack})`
						);
						return;
					}

					const restored = unfenceBraces(restoreAll(raw, info));

					// Judged against the slot's OWN source (a plural form
					// legitimately carries {count} where the singular does
					// not) and by the verdict the sweep uses, so the fill
					// refuses exactly what the sweep would empty: a renamed
					// {placeholder}, a loop, an essay where a label was asked
					// for, an answer in the wrong writing system.
					const verdict = slotVerdict(tag, unit.text, restored);

					if (verdict) {
						failed += 1;
						console.warn(
							`fill: ${tag} "${unit.text}" ${verdict} (${restored.slice(0, 40)})`
						);
						return;
					}

					unit.entry.msgstr[unit.slot] = restored;
					filled += 1;
				});

				flush();
				console.log(
					`fill: ${tag} ${filled + failed}/${limited.length} ` +
						`(+${filled} filled this pass)`
				);
			} catch (error) {
				failed += batch.length;
				console.error(
					`fill: ${tag} batch failed:`,
					(error as Error).stack ?? (error as Error).message
				);
			}
		}

		totalFilled += filled;
		totalFailed += failed;
		console.log(
			`fill: ${tag} done in ${((Date.now() - started) / 1000).toFixed(0)}s — ` +
				`${filled} filled, ${failed} failed, ${limited.length - filled - failed} skipped`
		);
	}

	console.log(`fill: ${totalFilled} filled, ${totalFailed} failed overall`);
	process.exit(0);
}

if (require.main === module) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
