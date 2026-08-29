// TODO: type
// @ts-nocheck

import {h as createElement, VNode} from "vue";
import parseStyle from "./ircmessageparser/parseStyle";
import findChannels from "./ircmessageparser/findChannels";
import {findLinks} from "../../../shared/linkify";
import findEmoji from "./ircmessageparser/findEmoji";
import findNames from "./ircmessageparser/findNames";
import merge, {MergedParts} from "./ircmessageparser/merge";
import {applyMarkdown, Range} from "./ircmessageparser/parseMarkdown";
import anyIntersection from "./ircmessageparser/anyIntersection";
import emojiMap from "./fullnamemap.json";
import LinkPreviewToggle from "../../components/LinkPreviewToggle.vue";
import LinkPreviewFileSize from "../../components/LinkPreviewFileSize.vue";
import InlineChannel from "../../components/InlineChannel.vue";
import Username from "../../components/Username.vue";
import {ClientMessage, ClientNetwork} from "../types";

const emojiModifiersRegex = /[\u{1f3fb}-\u{1f3ff}]|\u{fe0f}/gu;

type Fragment = {
	class?: string[];
	text?: string;
};

type StyledFragment = Fragment & {
	textColor?: string;
	bgColor?: string;
	hexColor?: string;
	hexBgColor?: string;

	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	monospace?: boolean;
	strikethrough?: boolean;

	codeBlock?: boolean;
	quote?: boolean;
	spoiler?: boolean;
	href?: string;
};

export type ParseOptions = {
	markdown?: boolean;
};

// Flags that wrap a run of neighbouring nodes in one element, outermost first
const WRAP_KEYS = ["quote", "codeBlock", "spoiler", "href"] as const;
type WrapKey = typeof WRAP_KEYS[number];
type Wrap = Partial<Record<WrapKey, boolean | string>>;
type Rendered = VNode | string | undefined | Rendered[];
type WrappedNode = {node: Rendered; wrap: Wrap};

function wrapOf(fragment: StyledFragment | undefined): Wrap {
	const wrap: Wrap = {};

	if (!fragment) {
		return wrap;
	}

	for (const key of WRAP_KEYS) {
		if (fragment[key]) {
			wrap[key] = fragment[key];
		}
	}

	return wrap;
}

function sameWrap(a: Wrap, b: Wrap) {
	return WRAP_KEYS.every((key) => a[key] === b[key]);
}

function toggleSpoiler(event: Event) {
	(event.currentTarget as HTMLElement).classList.toggle("md-spoiler-shown");
}

// The spoiler is a role="button" in the tab order, so it has to answer Enter
// and Space the way a real button does.
function spoilerKeydown(event: KeyboardEvent) {
	if (event.key !== "Enter" && event.key !== " ") {
		return;
	}

	if (event.key === " ") {
		// Otherwise Space scrolls the message list
		event.preventDefault();
	}

	toggleSpoiler(event);
}

function wrapNode(key: WrapKey, value: boolean | string, children: Rendered[]): VNode {
	switch (key) {
		case "quote":
			return createElement("span", {class: ["md-quote"]}, children);
		case "codeBlock":
			return createElement("code", {class: ["md-code-block"]}, children);
		case "spoiler":
			return createElement(
				"span",
				{
					class: ["md-spoiler"],
					role: "button",
					tabindex: 0,
					onClick: toggleSpoiler,
					onKeydown: spoilerKeydown,
				},
				children
			);
		case "href":
			// A masked link deliberately carries `title=url` and, unlike the
			// linkify anchors built in renderPart(), no `dir="auto"`. That is
			// what lets `test/e2e/markdown.spec.ts` pick the Markdown anchor out
			// with `a[title="https://example.com/"]` — keep both as they are.
			return createElement(
				"a",
				{href: value, title: value, target: "_blank", rel: "noopener"},
				children
			);
	}
}

// Groups neighbouring nodes that share a wrap flag under one element, nesting
// quote > codeBlock > spoiler > href.
function groupNodes(nodes: WrappedNode[], level = 0): Rendered[] {
	if (level === WRAP_KEYS.length) {
		return nodes.map((n) => n.node);
	}

	const key = WRAP_KEYS[level];
	const out: Rendered[] = [];
	let i = 0;

	while (i < nodes.length) {
		const value = nodes[i].wrap[key];
		let j = i + 1;

		while (j < nodes.length && nodes[j].wrap[key] === value) {
			j += 1;
		}

		const children = groupNodes(nodes.slice(i, j), level + 1);

		if (value) {
			out.push(wrapNode(key, value, children));
		} else {
			out.push(...children);
		}

		i = j;
	}

	return out;
}

// Create an HTML `span` with styling information for a given fragment
function createFragment(fragment: StyledFragment): VNode | string | undefined {
	const classes: string[] = [];

	if (fragment.bold) {
		classes.push("irc-bold");
	}

	if (fragment.textColor !== undefined) {
		classes.push("irc-fg" + fragment.textColor);
	}

	if (fragment.bgColor !== undefined) {
		classes.push("irc-bg" + fragment.bgColor);
	}

	if (fragment.italic) {
		classes.push("irc-italic");
	}

	if (fragment.underline) {
		classes.push("irc-underline");
	}

	if (fragment.strikethrough) {
		classes.push("irc-strikethrough");
	}

	if (fragment.monospace) {
		classes.push("irc-monospace");
	}

	const data: {
		class?: string[];
		style?: Record<string, string>;
	} = {
		class: undefined,
		style: undefined,
	};

	let hasData = false;

	if (classes.length > 0) {
		hasData = true;
		data.class = classes;
	}

	if (fragment.hexColor) {
		hasData = true;
		data.style = {
			color: `#${fragment.hexColor}`,
		};

		if (fragment.hexBgColor) {
			data.style["background-color"] = `#${fragment.hexBgColor}`;
		}
	}

	return hasData ? createElement("span", data, fragment.text) : fragment.text;
}

// Transform an IRC message potentially filled with styling control codes, URLs,
// nicknames, and channels into a string of HTML elements to display on the client.
function parse(
	text: string,
	message?: ClientMessage,
	network?: ClientNetwork,
	options: ParseOptions = {}
) {
	// Extract the styling information and get the plain text version from it
	let styleFragments = parseStyle(text);
	let verbatim: Range[] = [];

	if (options.markdown) {
		const markdown = applyMarkdown(styleFragments);
		styleFragments = markdown.fragments;
		verbatim = markdown.verbatim;
	}

	const cleanText = styleFragments.map((fragment) => fragment.text).join("");

	// Nicks, channels and emoji are not looked up inside code
	const outsideVerbatim = (part: {start: number; end: number}) =>
		!verbatim.some((range) => anyIntersection(range, part));

	// On the plain text, find channels and URLs, returned as "parts". Parts are
	// arrays of objects containing start and end markers, as well as metadata
	// depending on what was found (channel or link).
	const channelPrefixes = network ? network.serverOptions.CHANTYPES : ["#", "&"];
	const userModes = network
		? network.serverOptions.PREFIX?.prefix?.map((pref) => pref.symbol)
		: ["!", "@", "%", "+"];
	const channelParts = findChannels(cleanText, channelPrefixes, userModes).filter(
		outsideVerbatim
	);
	const linkParts = findLinks(cleanText);
	const emojiParts = findEmoji(cleanText).filter(outsideVerbatim);
	const nameParts = findNames(cleanText, message ? message.users || [] : []).filter(
		outsideVerbatim
	);

	const parts = (channelParts as MergedParts)
		.concat(linkParts)
		.concat(emojiParts)
		.concat(nameParts);

	// Merge the styling information with the channels / URLs / nicks / text objects and
	// generate HTML strings with the resulting fragments
	const nodes: WrappedNode[] = [];

	for (const textPart of merge(parts, styleFragments, cleanText)) {
		const isPlain = !textPart.link && !textPart.channel && !textPart.emoji && !textPart.nick;

		if (!isPlain || textPart.fragments.length === 0) {
			nodes.push({
				node: renderPart(
					textPart,
					textPart.fragments.map((fragment) => createFragment(fragment)),
					message
				),
				wrap: wrapOf(textPart.fragments[0]),
			});
			continue;
		}

		// Plain text may cross a quote/code/spoiler/link boundary: split it there
		let run: StyledFragment[] = [];
		let runWrap = wrapOf(textPart.fragments[0]);

		for (const fragment of textPart.fragments) {
			const wrap = wrapOf(fragment);

			if (!sameWrap(wrap, runWrap) && run.length) {
				nodes.push({
					node: run.map((item) => createFragment(item)),
					wrap: runWrap,
				});
				run = [];
			}

			runWrap = wrap;
			run.push(fragment);
		}

		nodes.push({node: run.map((item) => createFragment(item)), wrap: runWrap});
	}

	return options.markdown ? groupNodes(nodes) : nodes.map((n) => n.node);
}

// Wrap potentially styled fragments with links, channel buttons, emoji, nicks
function renderPart(textPart, fragments: Rendered[], message?: ClientMessage): Rendered {
	if (textPart.link) {
		const preview =
			message && message.previews && message.previews.find((p) => p.link === textPart.link);
		const link = createElement(
			"a",
			{
				href: textPart.link,
				dir: preview ? null : "auto",
				target: "_blank",
				rel: "noopener",
			},
			fragments
		);

		if (!preview) {
			return link;
		}

		const linkEls = [link];

		if (preview.size > 0) {
			linkEls.push(
				createElement(LinkPreviewFileSize, {
					size: preview.size,
				})
			);
		}

		linkEls.push(
			createElement(LinkPreviewToggle, {
				link: preview,
				message: message,
			})
		);

		// We wrap the link, size, and the toggle button into <span dir="auto">
		// to correctly keep the left-to-right order of these elements
		return createElement(
			"span",
			{
				dir: "auto",
			},
			linkEls
		);
	} else if (textPart.channel) {
		return createElement(
			InlineChannel,
			{
				channel: textPart.channel,
			},
			{
				default: () => fragments,
			}
		);
	} else if (textPart.emoji) {
		const emojiWithoutModifiers = textPart.emoji.replace(emojiModifiersRegex, "");
		const title = emojiMap[emojiWithoutModifiers]
			? `Emoji: ${emojiMap[emojiWithoutModifiers]}`
			: null;

		return createElement(
			"span",
			{
				class: ["emoji"],
				role: "img",
				"aria-label": title,
				title: title,
			},
			fragments
		);
	} else if (textPart.nick) {
		return createElement(
			Username,
			{
				user: {
					nick: textPart.nick,
				},
				dir: "auto",
			},
			{
				default: () => fragments,
			}
		);
	}

	return fragments;
}

export default parse;
