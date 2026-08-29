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
A block-ish Markdown container in the layout tree — quote, code block, spoiler, or masked link — that encloses a run of neighbouring nodes.
_Avoid_: container, block, group

**Masked link**:
A `[text](url)` link whose visible text differs from its destination. Rendered with the destination in the title and a distinguishing class.
_Avoid_: markdown link, labelled link

**Code block**:
A verbatim span rendered as rows, one per line: numbered from a CSS counter
once there are two or more, and syntax-highlighted when the fence named a
language or the guesser recognised one.
_Avoid_: fenced block, pre, snippet

**Monospace block**:
A server-produced multi-line message rendered verbatim in a monospace face — the MOTD. Never interpreted as Markdown.
_Avoid_: MOTD block, preformatted message
