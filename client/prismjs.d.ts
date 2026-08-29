// `@types/prismjs` types the `prismjs` entry point, which bundles the core and
// a handful of default grammars. We load the bare core and fetch grammars as
// chunks, so the subpaths need declaring; the core exports the same shape.
declare module "prismjs/components/prism-core" {
	import * as Prism from "prismjs";

	const core: typeof Prism;
	export default core;
}
