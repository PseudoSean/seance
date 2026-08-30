/**
 * The two facts about a code block that the renderer needs before — and
 * without — the highlighter.
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
