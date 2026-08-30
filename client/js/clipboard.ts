// Puts `text` on the clipboard, and says whether it got there.
//
// `navigator.clipboard` is a secure-context API, and it can reject even where
// it exists (a denied permission, a gesture the browser did not credit), so
// the old selection trick is the fallback: a deploy served over plain http on
// a LAN has no other way. Neither path has anywhere to report a failure, so
// the caller only learns whether it worked.
export async function writeClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// No clipboard API, or it refused: fall through to the fallback
	}

	const area = document.createElement("textarea");

	area.value = text;
	area.setAttribute("readonly", "");
	// The copy is of a selection, so the textarea is put out of sight rather
	// than hidden (what `display: none` holds cannot be selected) and told to
	// be selectable at all (`body` is `user-select: none`)
	area.style.position = "fixed";
	area.style.top = "-1000px";
	area.style.userSelect = "text";
	document.body.appendChild(area);

	try {
		area.select();
		return document.execCommand("copy");
	} catch {
		// Nothing copied, and nothing to say about it
		return false;
	} finally {
		area.remove();
	}
}

export default function (chat: HTMLDivElement) {
	// Disable in Firefox as it already copies flex text correctly
	// @ts-expect-error Property 'InstallTrigger' does not exist on type 'Window & typeof globalThis'.ts(2339)
	if (typeof window.InstallTrigger !== "undefined") {
		return;
	}

	const selection = window.getSelection();

	if (!selection) {
		return;
	}

	// If selection does not span multiple elements, do nothing
	if (selection.anchorNode === selection.focusNode) {
		return;
	}

	const range = selection.getRangeAt(0);
	const documentFragment = range.cloneContents();
	const div = document.createElement("div");

	div.id = "js-copy-hack";
	div.appendChild(documentFragment);
	chat.appendChild(div);

	selection.selectAllChildren(div);

	window.setTimeout(() => {
		chat.removeChild(div);
		selection.removeAllRanges();
		selection.addRange(range);
	}, 0);
}
