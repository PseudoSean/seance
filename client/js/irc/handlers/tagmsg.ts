/**
 * TAGMSG: a line that is nothing but client tags. The only ones Seance acts
 * on are reactions (bus-contract §1.4): `+draft/react=<text>` or
 * `+draft/unreact=<text>` together with a `+draft/reply=<msgid>` (or
 * `+reply`) naming the message reacted to — the poxchat / nefarious2
 * convention, which the server also stores and replays inside chathistory
 * batches for channels (never for queries). Everything else (`+typing`,
 * unknown tags) is ignored.
 *
 * The reaction becomes `msg:react {chan, id, text, nick, remove}` for the
 * loaded message the msgid resolves to; without one it is dropped. Inside
 * a history replay the lookup waits until the batch's messages have ids
 * (`IrcClient.afterReplay`).
 */

import {ChanType} from "../../../../shared/types/chan";
import {REACT_TAG, UNREACT_TAG} from "../wire";
import type {Channel} from "../channel";
import type {Handler} from "../types";
import {ignoreListFor} from "../../ignore";
import {replyTagOf, splitStatusTarget} from "./privmsg";

const tagmsg: Handler = (client, msg) => {
	const source = msg.source;

	if (!source) {
		return;
	}

	const nick = source.name;
	const react = msg.tags.get(REACT_TAG);
	const unreact = msg.tags.get(UNREACT_TAG);
	const text = react || unreact;
	const parent = replyTagOf(msg);

	if (!text || !parent) {
		return; // `+typing` and friends
	}

	const self = client.isSelf(nick);

	if (!self && ignoreListFor(client.uuid).matches(nick, source.user, source.host)) {
		return;
	}

	let chan: Channel | undefined;

	if (client.replaying) {
		chan = client.replayTarget;
	} else {
		let {target} = splitStatusTarget(client, msg.params[0] ?? "");

		// A private TAGMSG belongs to the query with the other party: the
		// sender's, or the target's when the sender is us (echo-message).
		if (client.isSelf(target)) {
			target = nick;
		}

		chan = client.findChannel(target);
	}

	if (!chan || (chan.type !== ChanType.CHANNEL && chan.type !== ChanType.QUERY)) {
		return; // target not loaded: nothing to attach the reaction to
	}

	const target = chan;
	const remove = react === undefined || react === "";

	client.afterReplay(() => {
		const id = target.idOf(parent);

		if (id !== undefined) {
			client.dispatch("msg:react", {chan: target.id, id, text, nick, remove});
		}
	});
};

export default {TAGMSG: tagmsg};
