import {h as createElement, VNode} from "vue";
import {LayoutNode, Style} from "./ircmessageparser/layout";

type TextNode = Extract<LayoutNode, {kind: "text"}>;

// Create an HTML `span` with styling information for a given text node
export function createFragment(node: TextNode): VNode | string {
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
