/**
 * INVITE (`invite-notify` shows other people's invites too).
 */

import {MessageType} from "../../../../shared/types/msg";
import type {Handler} from "../types";

const invite: Handler = (client, msg) => {
	const [invited = "", channelName = ""] = msg.params;
	const nick = msg.source?.name ?? "";
	const chan = client.findChannel(channelName) ?? client.lobby;
	const invitedYou = client.isSelf(invited);

	client.pushMessage(
		chan,
		{
			type: MessageType.INVITE,
			time: client.timeOf(msg),
			from: chan.userRef(nick),
			target: chan.userRef(invited),
			channel: channelName,
			highlight: invitedYou,
			invitedYou,
			showInActive: chan === client.lobby,
		},
		invitedYou
	);
};

export default {INVITE: invite};
