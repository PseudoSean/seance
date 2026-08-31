/**
 * What the renderer needs to know about a code block before — and without —
 * the highlighter: how it splits into lines, whether a language guess is worth
 * a fetch, and how much of it to show.
 *
 * `highlighter.ts` re-exports both, so it stays the module the highlighting
 * interface lives in; they sit here because it is a lazily-loaded chunk
 * (Prism, its alias table, its grammars) and `CodeBlock.vue` has to lay a block
 * out plainly first, deciding on the gutter and whether a guess is worth the
 * fetch at all.
 */

// Shorter blocks are never guessed: one line is as likely to be prose as code
export const MIN_GUESS_LINES = 2;

// The lines of a code block. A trailing newline ends the last line rather than
// starting an empty one, which is what a fenced block usually carries.
export function splitLines(code: string): string[] {
	const lines = code.split("\n");

	if (lines.length > 1 && lines[lines.length - 1] === "") {
		lines.pop();
	}

	return lines;
}

// A block longer than this collapses to an excerpt with a toggle under it.
// Twelve lines is about what fits beside the rest of a conversation; past that
// a pasted file is scrollback nobody asked for.
export const COLLAPSE_THRESHOLD = 12;
// How many lines a collapsed block shows: enough to recognise what the block
// is, short enough that the toggle is the obvious next thing.
export const COLLAPSE_EXCERPT = 8;

// How many of a block's lines to render, or undefined for all of them — the
// whole of the collapse decision, so `CodeBlock` only has to obey it.
export function excerptRange(lineCount: number): number | undefined {
	return lineCount > COLLAPSE_THRESHOLD ? COLLAPSE_EXCERPT : undefined;
}
