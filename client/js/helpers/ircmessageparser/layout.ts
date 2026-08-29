import {findLinks} from "../../../../shared/linkify";
import anyIntersection from "./anyIntersection";
import findChannels from "./findChannels";
import findEmoji from "./findEmoji";
import findNames from "./findNames";
import merge, {MergedParts, Part, PartWithFragments} from "./merge";
import {applyMarkdown, Range} from "./parseMarkdown";
import parseStyle, {ParsedStyle} from "./parseStyle";

export type LayoutOptions = {
	markdown?: boolean;
	channelPrefixes?: string[];
	userModes?: string[];
	users?: string[];
};

// What a text node looks like. Presentation only: the wraps are nodes of their
// own, and verbatim has done its job by the time the tree is built.
export type Style = Pick<
	ParsedStyle,
	| "bold"
	| "italic"
	| "underline"
	| "strikethrough"
	| "monospace"
	| "textColor"
	| "bgColor"
	| "hexColor"
	| "hexBgColor"
>;

// The layout tree: what a message renders as, as plain data. Every adapter
// (VNodes, plain text) walks this, so the rendering decision is made once and
// can be asserted without a browser.
export type LayoutNode =
	| {kind: "text"; text: string; style: Style}
	| {kind: "link"; link: string; children: LayoutNode[]}
	| {kind: "channel"; channel: string; children: LayoutNode[]}
	| {kind: "emoji"; emoji: string; children: LayoutNode[]}
	| {kind: "nick"; nick: string; children: LayoutNode[]}
	| {kind: "wrap"; wrap: "quote" | "spoiler"; children: LayoutNode[]}
	// `lang` is the fence's language tag, when it named one
	| {kind: "wrap"; wrap: "codeBlock"; lang?: string; children: LayoutNode[]}
	| {kind: "wrap"; wrap: "href"; href: string; children: LayoutNode[]};

// Flags that wrap a run of neighbouring nodes in one element, outermost first
const WRAP_KEYS = ["quote", "codeBlock", "spoiler", "href"] as const;
type WrapKey = typeof WRAP_KEYS[number];
// `lang` is not a wrap of its own: it qualifies `codeBlock`, so that two
// blocks in different languages never end up under one element.
type Wrap = Partial<Record<WrapKey, boolean | string>> & {lang?: string};
// A part, or one run of a part's text, and the wraps it sits in
type WrappedNodes = {nodes: LayoutNode[]; wrap: Wrap};

// Decides what a message renders as: IRC styling, Markdown, and the things the
// finders make interactive, as one tree.
export function layout(text: string, options: LayoutOptions = {}): LayoutNode[] {
	let fragments = parseStyle(text);
	let verbatim: Range[] = [];

	if (options.markdown) {
		const markdown = applyMarkdown(fragments);
		fragments = markdown.fragments;
		verbatim = markdown.verbatim;
	}

	const cleanText = fragments.map((fragment) => fragment.text).join("");

	// Nicks, channels and emoji are not looked up inside code
	const outsideVerbatim = (part: Part) => !verbatim.some((range) => anyIntersection(range, part));

	// On the plain text, find channels and URLs, returned as "parts". Parts are
	// objects containing start and end markers, as well as metadata depending on
	// what was found (channel or link).
	const channelPrefixes = options.channelPrefixes ?? ["#", "&"];
	const userModes = options.userModes ?? ["!", "@", "%", "+"];
	const channelParts = findChannels(cleanText, channelPrefixes, userModes).filter(
		outsideVerbatim
	);
	const linkParts = findLinks(cleanText);
	const emojiParts = findEmoji(cleanText).filter(outsideVerbatim);
	const nameParts = findNames(cleanText, options.users ?? []).filter(outsideVerbatim);

	const parts = (channelParts as MergedParts)
		.concat(linkParts)
		.concat(emojiParts)
		.concat(nameParts);

	// Merge the styling information with the channels / URLs / nicks / text
	// objects, then group what shares a wrap
	const wrapped: WrappedNodes[] = [];

	for (const part of merge(parts, fragments, cleanText)) {
		const found = partNode(part);

		if (found) {
			wrapped.push({nodes: [found], wrap: wrapOf(part.fragments[0])});
			continue;
		}

		if (part.fragments.length === 0) {
			wrapped.push({nodes: [], wrap: {}});
			continue;
		}

		// Plain text may cross a quote/code/spoiler/link boundary: split it there
		let run: LayoutNode[] = [];
		let runWrap = wrapOf(part.fragments[0]);

		for (const fragment of part.fragments) {
			const wrap = wrapOf(fragment);

			if (!sameWrap(wrap, runWrap) && run.length) {
				wrapped.push({nodes: run, wrap: runWrap});
				run = [];
			}

			runWrap = wrap;
			run.push(textNode(fragment));
		}

		wrapped.push({nodes: run, wrap: runWrap});
	}

	return options.markdown
		? groupNodes(wrapped)
		: wrapped.flatMap((wrappedNodes) => wrappedNodes.nodes);
}

// The message as text, markers and all interactivity gone (window titles).
export function toPlainText(nodes: LayoutNode[]): string {
	let out = "";

	for (const node of nodes) {
		out += node.kind === "text" ? node.text : toPlainText(node.children);
	}

	return out;
}

// The node a finder asked for, or undefined when the part is plain text.
function partNode(part: PartWithFragments<ParsedStyle>): LayoutNode | undefined {
	const children = part.fragments.map(textNode);

	if (part.link) {
		return {kind: "link", link: part.link, children};
	}

	if (part.channel) {
		return {kind: "channel", channel: part.channel, children};
	}

	if (part.emoji) {
		return {kind: "emoji", emoji: part.emoji, children};
	}

	if (part.nick) {
		return {kind: "nick", nick: part.nick, children};
	}

	return undefined;
}

// Only the keys that are set, so an unstyled run carries an empty style
function textNode(fragment: ParsedStyle): LayoutNode {
	const style: Style = {};

	if (fragment.bold) {
		style.bold = true;
	}

	if (fragment.italic) {
		style.italic = true;
	}

	if (fragment.underline) {
		style.underline = true;
	}

	if (fragment.strikethrough) {
		style.strikethrough = true;
	}

	if (fragment.monospace) {
		style.monospace = true;
	}

	// Colour 0 is white, so these are set-or-not, not truthy-or-not
	if (fragment.textColor !== undefined) {
		style.textColor = fragment.textColor;
	}

	if (fragment.bgColor !== undefined) {
		style.bgColor = fragment.bgColor;
	}

	if (fragment.hexColor !== undefined) {
		style.hexColor = fragment.hexColor;
	}

	if (fragment.hexBgColor !== undefined) {
		style.hexBgColor = fragment.hexBgColor;
	}

	return {kind: "text", text: fragment.text, style};
}

function wrapOf(fragment: ParsedStyle | undefined): Wrap {
	const wrap: Wrap = {};

	if (!fragment) {
		return wrap;
	}

	for (const key of WRAP_KEYS) {
		if (fragment[key]) {
			wrap[key] = fragment[key];
		}
	}

	if (fragment.codeBlock && fragment.lang) {
		wrap.lang = fragment.lang;
	}

	return wrap;
}

function sameWrap(a: Wrap, b: Wrap) {
	return WRAP_KEYS.every((key) => a[key] === b[key]) && a.lang === b.lang;
}

function wrapNode(key: WrapKey, wrap: Wrap, children: LayoutNode[]): LayoutNode {
	if (key === "href") {
		return {kind: "wrap", wrap: "href", href: String(wrap.href), children};
	}

	if (key === "codeBlock") {
		return wrap.lang === undefined
			? {kind: "wrap", wrap: "codeBlock", children}
			: {kind: "wrap", wrap: "codeBlock", lang: wrap.lang, children};
	}

	return {kind: "wrap", wrap: key, children};
}

// Groups neighbouring nodes that share a wrap flag under one node, nesting
// quote > codeBlock > spoiler > href.
function groupNodes(nodes: WrappedNodes[], level = 0): LayoutNode[] {
	if (level === WRAP_KEYS.length) {
		return nodes.flatMap((wrappedNodes) => wrappedNodes.nodes);
	}

	const key = WRAP_KEYS[level];
	const out: LayoutNode[] = [];
	let i = 0;

	while (i < nodes.length) {
		const wrap = nodes[i].wrap;
		const value = wrap[key];
		// A code block only continues while the language stays the same
		const lang = key === "codeBlock" ? wrap.lang : undefined;
		let j = i + 1;

		while (
			j < nodes.length &&
			nodes[j].wrap[key] === value &&
			(key !== "codeBlock" || nodes[j].wrap.lang === lang)
		) {
			j += 1;
		}

		const children = groupNodes(nodes.slice(i, j), level + 1);

		if (value) {
			out.push(wrapNode(key, wrap, children));
		} else {
			out.push(...children);
		}

		i = j;
	}

	return out;
}
