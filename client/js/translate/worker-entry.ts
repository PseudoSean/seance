/**
 * Entry of the translation worker (public/js/translate-worker.js, built by
 * the third webpack configuration). The page starts it with
 * `new Worker("js/translate-worker.js?v=<build>")` (client/js/translate/
 * index.ts) and speaks the protocol in protocol.ts to it. This is the only
 * file that wires the real engines: everything else is injected.
 */
import {WebLlmEngine} from "./engines/webllm";
import {realWebLlmDeps, webllmCache} from "./engines/webllm.real";
import {Seq2seqEngine} from "./engines/seq2seq";
import {configureTransformers, realSeq2seqDeps, seq2seqCache} from "./engines/seq2seq.real";
import {languageName} from "./languages";
import {CacheApi, ModelCatalog} from "./models";
import {WorkerPort} from "./protocol";
import {serveEngines} from "./worker";

let catalog: ModelCatalog | null = null;

const llm = new WebLlmEngine(realWebLlmDeps, languageName);
const seq2seq = new Seq2seqEngine(realSeq2seqDeps);
const llmCache = webllmCache(() => catalog);
const seqCache = seq2seqCache();
const cache: CacheApi = {
	has: (ref) => (ref.engine === "llm" ? llmCache : seqCache).has(ref),
	delete: (ref) => (ref.engine === "llm" ? llmCache : seqCache).delete(ref),
};

serveEngines(
	self as unknown as WorkerPort,
	{llm, seq2seq},
	{
		cache,
		configure(next, ortBase) {
			catalog = next;
			llm.configure(next);
			configureTransformers({modelBase: next.modelBase, ortBase});
		},
	}
);
