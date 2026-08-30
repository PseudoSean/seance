# Seance

A static, bouncer-less IRC client: the browser speaks IRCv3 to the server over a WebSocket and renders every line it receives. This glossary names the concepts in the message-rendering pipeline; other areas add their terms as they are sharpened.

## Messages on the wire

**Multi-line message**:
One message whose text contains line feeds — one msgid, one timeline entry, one thing to reply to, react to, edit or delete, however many lines it shows. Only possible where the server and client have agreed to it; where they have not, each line is a message of its own.
_Avoid_: multiline batch, paragraph, block message
