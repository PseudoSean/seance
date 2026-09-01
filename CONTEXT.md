# Seance

A static, bouncer-less IRC client: the browser speaks IRCv3 to the server over a WebSocket and renders every line it receives. This glossary names the concepts in the message-rendering pipeline; other areas add their terms as they are sharpened.

## Message rendering

**Fragment**:
A run of message text that shares one presentation: IRC colour and style codes plus any Markdown flags. The unit everything after the parsers works on.
_Avoid_: span, segment, styled text

**Marker**:
A Markdown delimiter character sequence (`**`, `_`, `` ` ``, `> `, `||`, `[…](…)`). Markers are removed from the text they shape; unmatched markers are ordinary text.
_Avoid_: token, syntax, delimiter

**Opaque span**:
A stretch of text the Markdown tokenizer never interprets, such as a URL, so its characters cannot become markers.
_Avoid_: skip range, protected region

**Verbatim span**:
A stretch of text rendered exactly as written — inline code and code blocks — where neither Markdown nor the channel, nick and emoji finders apply. `findLinks` is the exception: it still runs, so a URL inside inline code is a link, while a code block renders only its characters and a URL inside one is not.
_Avoid_: code range, suppression hint

**Finder**:
A pass over the plain text that locates one kind of thing to make interactive: channels, links, emoji, nicks.
_Avoid_: matcher, detector

**Part**:
What a finder found, plus the plain text between findings: the horizontal division of a message into interactive and inert pieces.
_Avoid_: segment, chunk

**Layout tree**:
What a message renders as, decided once and expressed as plain data: parts and fragments nested inside wraps. Independent of Vue; every adapter (VNodes, plain text) walks the same tree.
_Avoid_: render tree, VNode tree, AST

**Wrap**:
A block-ish Markdown container in the layout tree — quote, header, list, table, code block, spoiler, math, or masked link — that encloses a run of neighbouring nodes.
_Avoid_: container, block, group

**Header**:
A line-level wrap giving a line document-heading emphasis, at one of six levels: `#` to `######` and a space at the start of the line. The level is the wrap's value, so two neighbouring lines of one level share a wrap and two of different levels do not.
_Avoid_: heading, title, hn

**Masked link**:
A `[text](url)` link whose visible text differs from its destination. Rendered with the destination in the title and a distinguishing class.
_Avoid_: markdown link, labelled link

**Code block**:
A verbatim span rendered as rows, one per line: numbered from a CSS counter once there are two or more, syntax-highlighted when the fence named a language or the guesser recognised one, and captioned above with the file a `lang:file` tag named, else the language — a label row, never an empty line of code. A fence is a run of three or more backticks closed by a run at least as long.
_Avoid_: fenced block, pre, snippet

**List**:
A run of `- ` or `1. `–`9. ` lines under one wrap, the markers removed and the bullet or number drawn by the stylesheet; the wrap's value is `ul` or `ol:` with the list's first number. They do not nest.
_Avoid_: bullet points, ul, ol

**Table**:
A GFM pipe table under one wrap: cells separated by pipes the scanner keeps, rows by the newlines it keeps, the separator row removed and its colons carried as the columns' alignment. Rendered as a real `<table>`, first row the header.
_Avoid_: grid, spreadsheet

**Math**:
A TeX span — `` $`…`$ `` inline, `$$…$$` display — rendered by KaTeX from a lazily loaded chunk, the raw TeX shown until it lands. The one place a library's HTML is set on the page directly, because KaTeX escapes everything it is given.
_Avoid_: latex block, formula, equation

**Shortcode**:
An `:name:` the emoji map knows, rendered as the character it stands for through the same span unicode emoji gets. Only a known alias matches, which is what keeps timestamps out.
_Avoid_: emoji name, smiley code

**Excerpt**:
The visible head of a collapsed code block — the first lines of a block too long to show whole, with a toggle under them offering the rest. The lines it leaves out are not in the DOM.
_Avoid_: preview, truncation, snippet, fold

**Monospace block**:
A server-produced multi-line message rendered verbatim in a monospace face — the MOTD. Never interpreted as Markdown.
_Avoid_: MOTD block, preformatted message

**Multi-line message**:
One message whose text contains line feeds — one msgid, one timeline entry, one thing to reply to, react to, edit or delete, however many lines it shows. Only possible where the server and client have agreed to it; where they have not, each line is a message of its own.
_Avoid_: multiline batch, paragraph, block message
