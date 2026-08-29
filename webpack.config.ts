import * as webpack from "webpack";
import * as path from "path";
import CopyPlugin from "copy-webpack-plugin";
import ForkTsCheckerWebpackPlugin from "fork-ts-checker-webpack-plugin";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import {VueLoaderPlugin} from "vue-loader";
import babelConfig from "./babel.config.cjs";
import {createHash} from "crypto";
import {readFileSync} from "fs";
import pkg from "./package.json";

// Short hash of the package version, appended to asset URLs so browsers
// and the service worker refetch after a release.
const cacheBust = createHash("sha256").update(`v${pkg.version}`).digest("hex").substring(0, 10);

// Build-time branding. `client/config.json` is the same file the app fetches
// at runtime (copied to `public/config.json`); the values below only feed the
// parts of index.html and the manifest that exist before any script runs.
// See docs/resources/branding.md.
interface BuildBranding {
	appName: string;
	shortName: string;
	description: string;
	themeColor: string;
}

function readBranding(): BuildBranding {
	let raw: Record<string, unknown> = {};

	try {
		raw = JSON.parse(readFileSync(path.resolve(__dirname, "client/config.json"), "utf8"));
	} catch (e: any) {
		throw new Error(`client/config.json is missing or not valid JSON: ${e.message}`);
	}

	const str = (value: unknown, fallback: string): string =>
		typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;

	const appName = str(raw.appName, "Seance");

	return {
		appName,
		shortName: str(raw.shortName, appName),
		description: str(raw.description, "IRC client"),
		themeColor: str(raw.themeColor, "#415364"),
	};
}

const branding = readBranding();

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function brandHtml(content: string): string {
	return content
		.replace(/__APP_NAME__/g, escapeHtml(branding.appName))
		.replace(/__THEME_COLOR__/g, escapeHtml(branding.themeColor));
}

function brandManifest(content: string): string {
	const manifest = JSON.parse(content);
	manifest.name = branding.appName;
	manifest.short_name = branding.shortName;
	manifest.description = branding.description;
	manifest.theme_color = branding.themeColor;
	manifest.background_color = branding.themeColor;
	return JSON.stringify(manifest, null, "\t") + "\n";
}

// Third-party notices for the lazily loaded chunks. Prism's core carries a
// `@license` comment terser extracts by itself, but not its copyright line, and
// flourite's build carries nothing at all — so state both, in a `/*!` banner
// that ends up in the chunk's `.LICENSE.txt`. Both are MIT; see
// docs/projects/markdown-messages.md.
const chunkNotices: Record<string, string> = {
	"js/highlighter.js":
		"/*! prismjs 1.30.0 (and the js/prism-*.js grammar chunks) | MIT | " +
		"Copyright (c) 2012 Lea Verou | https://github.com/PrismJS/prism */\n",
	"js/flourite.js":
		"/*! flourite 1.3.0 | MIT | Copyright (c) 2015 Toni Sučić, " +
		"Copyright (c) 2024 Teknologi Umum | https://github.com/teknologi-umum/flourite */\n",
};

const noticePlugin = new webpack.BannerPlugin({
	raw: true,
	test: /^js\/(highlighter|flourite)\.js$/,
	banner: ({filename}) => chunkNotices[filename] ?? "",
});

const tsCheckerPlugin = new ForkTsCheckerWebpackPlugin({
	typescript: {
		diagnosticOptions: {
			semantic: true,
			syntactic: true,
		},
		build: true,
	},
});

const vueLoaderPlugin = new VueLoaderPlugin();

const miniCssExtractPlugin = new MiniCssExtractPlugin({
	filename: "css/style.css",
});

const isProduction = process.env.NODE_ENV === "production";
const config: webpack.Configuration = {
	mode: isProduction ? "production" : "development",
	entry: {
		"js/bundle.js": [path.resolve(__dirname, "client/js/vue.ts")],
	},
	devtool: "source-map",
	output: {
		clean: true, // Clean the output directory before emit.
		path: path.resolve(__dirname, "public"),
		filename: "[name]",
		// Lazily loaded chunks (the highlighter, its Prism grammars, the
		// language guesser). `filename` carries the `js/` prefix in the entry
		// name, so chunks have to say it here.
		chunkFilename: "js/[name].js",
		// Not "/": a deploy may live under a subpath (https://host/chat/), and
		// an absolute public path would send every `import()` to /js/… . "auto"
		// derives it from the running script's own URL, undoing the entry's
		// `js/` depth, so a chunk resolves to <page dir>/js/<name>.js wherever
		// the tree is served from. Everything else (index.html, the service
		// worker's precache list) is already scope-relative.
		publicPath: "auto",
	},
	performance: {
		hints: false,
	},
	resolve: {
		extensions: [".ts", ".js", ".vue"],
	},
	module: {
		rules: [
			{
				test: /\.vue$/,
				use: {
					loader: "vue-loader",
					options: {
						compilerOptions: {
							preserveWhitespace: false,
						},
						appendTsSuffixTo: [/\.vue$/],
					},
				},
			},
			{
				test: /\.ts$/i,
				include: [path.resolve(__dirname, "client"), path.resolve(__dirname, "shared")],
				exclude: path.resolve(__dirname, "node_modules"),
				use: {
					loader: "babel-loader",
					options: babelConfig,
				},
			},
			{
				test: /\.css$/,
				use: [
					{
						loader: MiniCssExtractPlugin.loader,
						options: {
							esModule: false,
						},
					},
					{
						loader: "css-loader",
						options: {
							url: false,
							importLoaders: 1,
							sourceMap: true,
						},
					},
					{
						loader: "postcss-loader",
						options: {
							sourceMap: true,
						},
					},
				],
			},
		],
	},
	optimization: {
		splitChunks: {
			cacheGroups: {
				// Webpack's own async vendor split would put Prism and its
				// language table in a chunk named after a number, which is a
				// stale-cache hazard (ids move between builds) for no gain:
				// the highlighter chunk is their only consumer.
				defaultVendors: false,
				commons: {
					test: /[\\/]node_modules[\\/]/,
					name: "js/bundle.vendor.js",
					// Initial chunks only: with "all", the dependencies of a
					// lazily loaded chunk (Prism and its ~300 grammars) are
					// hoisted into the vendor bundle, which is the opposite of
					// what importing them on demand is for.
					chunks: "initial",
				},
			},
		},
	},
	externals: {
		json3: "JSON", // socket.io uses json3.js, but we do not target any browsers that need it
	},
	plugins: [
		tsCheckerPlugin,
		vueLoaderPlugin,
		noticePlugin,
		new webpack.DefinePlugin({
			__VUE_PROD_DEVTOOLS__: false,
			__VUE_OPTIONS_API__: false,
		}),
		miniCssExtractPlugin,
		new CopyPlugin({
			patterns: [
				{
					from: path
						.resolve(
							__dirname,
							"node_modules/@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff*"
						)
						.replace(/\\/g, "/"),
					to: "fonts/[name][ext]",
				},
				{
					from: path.resolve(__dirname, "./client/js/loading-error-handlers.js"),
					to: "js/[name][ext]",
				},
				{
					from: path.resolve(__dirname, "./client/*").replace(/\\/g, "/"),
					to: "[name][ext]",
					globOptions: {
						ignore: [
							"**/index.html",
							"**/service-worker.js",
							"**/manifest.webmanifest",
							"**/*.d.ts",
							"**/tsconfig.json",
						],
					},
				},
				{
					from: path.resolve(__dirname, "./client/index.html"),
					to: "[name][ext]",
					transform(content) {
						return brandHtml(
							content
								.toString()
								.replace(/__HASH__/g, isProduction ? cacheBust : "dev")
						);
					},
				},
				{
					from: path.resolve(__dirname, "./client/manifest.webmanifest"),
					to: "[name][ext]",
					transform(content) {
						return brandManifest(content.toString());
					},
				},
				{
					from: path.resolve(__dirname, "./client/service-worker.js"),
					to: "[name][ext]",
					transform(content) {
						return content
							.toString()
							.replace("__HASH__", isProduction ? cacheBust : "dev");
					},
				},
				{
					from: path.resolve(__dirname, "./client/audio/*").replace(/\\/g, "/"),
					to: "audio/[name][ext]",
				},
				{
					from: path.resolve(__dirname, "./client/img/*").replace(/\\/g, "/"),
					to: "img/[name][ext]",
				},
				{
					from: path.resolve(__dirname, "./client/themes/*").replace(/\\/g, "/"),
					to: "themes/[name][ext]",
				},
			],
		}),
		// socket.io uses debug, we don't need it
		new webpack.NormalModuleReplacementPlugin(
			/debug/,
			path.resolve(__dirname, "scripts/noop.js")
		),
	],
};

export default (env: any, argv: any) => {
	if (argv.mode === "development") {
		config.target = "node";
		config.devtool = "eval";
		config.stats = "errors-only";
		config.output!.path = path.resolve(__dirname, "test/public");
		config.entry!["testclient.js"] = [path.resolve(__dirname, "test/client/index.ts")];

		// Add the istanbul plugin to babel-loader options
		for (const rule of config.module!.rules!) {
			// @ts-expect-error Property 'use' does not exist on type 'RuleSetRule | "..."'.
			if (rule.use.loader === "babel-loader") {
				// @ts-expect-error Property 'use' does not exist on type 'RuleSetRule | "..."'.
				rule.use.options.plugins = ["istanbul"];
			}
		}

		// `optimization.splitChunks` is incompatible with a `target` of `node`. See:
		// - https://github.com/zinserjan/mocha-webpack/issues/84
		// - https://github.com/webpack/webpack/issues/6727#issuecomment-372589122
		config.optimization!.splitChunks = false;

		// Disable plugins like copy files, it is not required
		config.plugins = [
			tsCheckerPlugin,
			vueLoaderPlugin,
			miniCssExtractPlugin,
			// Client tests that require Vue may end up requireing socket.io
			new webpack.NormalModuleReplacementPlugin(
				/js(\/|\\)socket\.js/,
				path.resolve(__dirname, "scripts/noop.js")
			),
		];
	}

	if (argv?.mode === "production") {
		// ...
	}

	return config;
};
