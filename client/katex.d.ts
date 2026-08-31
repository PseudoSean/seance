// KaTeX's own typings are not pointed at by its package.json, and the API the
// client uses is two calls wide — so a narrow declaration here instead.
declare module "katex" {
	const katex: {
		version: string;
		renderToString(
			tex: string,
			options?: {displayMode?: boolean; throwOnError?: boolean}
		): string;
	};

	export default katex;
}
