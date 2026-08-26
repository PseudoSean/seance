// Subscribes every server-to-client event handler to the bus. The IRC layer
// (client/js/irc/) dispatches these events; the payload shapes are documented
// in docs/resources/bus-contract.md.
//
// Removed for good (server-only concepts): auth, configuration,
// sessions_list, changelog, sign_out. Moved to local modules (no bus
// round-trip): setting, sync_sort, mute_changed, mentions, history_clear,
// search, msg_preview (previews are built client-side, see
// helpers/mediaPreview.ts).
import "./connection";
import "./commands";
import "./init";
import "./join";
import "./markread";
import "./more";
import "./msg";
import "./msg_special";
import "./names";
import "./network";
import "./nick";
import "./open";
import "./part";
import "./quit";
import "./topic";
import "./users";
