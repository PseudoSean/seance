// Subscribes every server-to-client event handler to the bus. Nothing
// dispatches these events yet (there is no transport); the handlers stay in
// place so the IRC layer can start feeding them in the next phase.
//
// Removed for good (server-only concepts): auth, configuration,
// sessions_list, changelog, sign_out. Moved to local modules (no bus
// round-trip): setting, sync_sort, mute_changed, mentions, history_clear,
// search.
import "./connection";
import "./commands";
import "./init";
import "./join";
import "./more";
import "./msg";
import "./msg_preview";
import "./msg_special";
import "./names";
import "./network";
import "./nick";
import "./open";
import "./part";
import "./quit";
import "./topic";
import "./users";
