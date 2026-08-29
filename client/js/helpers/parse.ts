import {h as createElement, VNode} from "vue";
import {layout, LayoutNode, Style} from "./ircmessageparser/layout";
import emojiMap from "./fullnamemap.json";
import LinkPreviewToggle from "../../components/LinkPreviewToggle.vue";
import LinkPreviewFileSize from "../../components/LinkPreviewFileSize.vue";
import InlineChannel from "../../components/InlineChannel.vue";
import Username from "../../components/Username.vue";
import {ClientMessage, ClientNetwork} from "../types";

const emojiModifiersRegex = /[\u{1f3fb}-\u{1f3ff}]|\u{fe0f}/gu;

export type ParseOptions = {
	markdown?: boolean;
};

type Rendered = VNode | string | undefined | Rendered[];
type TextNode = Extract<LayoutNode, {kind: "text"}>;
type WrapNode = Extract<LayoutNode, {kind: "wrap"}>;
type PartNode = Extract<LayoutNode, {kind: "link" | "channel" | "emoji" | "nick"}>;

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

function wrapNode(node: WrapNode, children: Rendered[]): VNode {
	switch (node.wrap) {
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
			// A masked link carries the destination in its title and the
			// `md-link` class, which is what tells it apart from a linkified
			// anchor (`test/e2e/markdown.spec.ts` picks it out that way).
			return createElement(
				"a",
				{
					class: ["md-link"],
					href: node.href,
					title: node.href,
					dir: "auto",
					target: "_blank",
					rel: "noopener",
				},
				children
			);
	}
}

// Create an HTML `span` with styling information for a given text node
function createFragment(node: TextNode): VNode | string {
	const style: Style = node.style;
	const classes: string[] = [];

	if (style.bold) {
		classes.push("irc-bold");
	}

	if (style.textColor !== undefined) {
		classes.push("irc-fg" + style.textColor);
	}

	if (style.bgColor !== undefined) {
		classes.push("irc-bg" + style.bgColor);
	}

	if (style.italic) {
		classes.push("irc-italic");
	}

	if (style.underline) {
		classes.push("irc-underline");
	}

	if (style.strikethrough) {
		classes.push("irc-strikethrough");
	}

	if (style.monospace) {
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

	if (style.hexColor) {
		hasData = true;
		data.style = {
			color: `#${style.hexColor}`,
		};

		if (style.hexBgColor) {
			data.style["background-color"] = `#${style.hexBgColor}`;
		}
	}

	return hasData ? createElement("span", data, node.text) : node.text;
}

// Transform an IRC message potentially filled with styling control codes, URLs,
// nicknames, and channels into a string of HTML elements to display on the client.
function parse(
	text: string,
	message?: ClientMessage,
	network?: ClientNetwork,
	options: ParseOptions = {}
) {
	return toVNodes(
		layout(text, {
			markdown: options.markdown,
			channelPrefixes: network ? network.serverOptions.CHANTYPES : ["#", "&"],
			userModes: network
				? network.serverOptions.PREFIX?.prefix?.map((pref) => pref.symbol)
				: ["!", "@", "%", "+"],
			users: message ? message.users || [] : [],
		}),
		message
	);
}

// The Vue adapter: one element per layout node.
function toVNodes(nodes: LayoutNode[], message?: ClientMessage): Rendered[] {
	return nodes.map((node) => {
		if (node.kind === "text") {
			return createFragment(node);
		}

		const children = toVNodes(node.children, message);

		return node.kind === "wrap"
			? wrapNode(node, children)
			: renderPart(node, children, message);
	});
}

// Wrap potentially styled fragments with links, channel buttons, emoji, nicks
function renderPart(node: PartNode, fragments: Rendered[], message?: ClientMessage): Rendered {
	switch (node.kind) {
		case "link": {
			const preview =
				message && message.previews && message.previews.find((p) => p.link === node.link);
			const link = createElement(
				"a",
				{
					href: node.link,
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
		}

		case "channel":
			return createElement(
				InlineChannel,
				{
					channel: node.channel,
				},
				{
					default: () => fragments,
				}
			);

		case "emoji": {
			const emojiWithoutModifiers = node.emoji.replace(emojiModifiersRegex, "");
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
		}

		case "nick":
			return createElement(
				Username,
				{
					user: {
						nick: node.nick,
					},
					dir: "auto",
				},
				{
					default: () => fragments,
				}
			);
	}
}

export default parse;
