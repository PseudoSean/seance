/**
 * `/ignorelist`: show the network's ignore list in the "Ignored users"
 * special window (`client/components/Special/ListIgnored.vue`).
 */

import {SpecialChanType} from "../../../../shared/types/chan";
import {MessageType} from "../../../../shared/types/msg";
import {ignoreListFor} from "../../ignore";
import {showSpecial} from "../handlers/list";
import {formatHostmask} from "../hostmask";
import type {Command} from "../types";

export const IGNORELIST_CHAN = "Ignored users";

const ignorelist: Command = {
	commands: ["ignorelist"],
	allowDisconnected: true,
	input({client, chan}) {
		const list = ignoreListFor(client.uuid);

		if (list.list.length === 0) {
			client.pushMessage(chan, {type: MessageType.ERROR, text: "Ignorelist is empty"});
			return;
		}

		const data = list.list.map((entry) => ({
			hostmask: formatHostmask(entry),
			when: entry.when,
		}));

		showSpecial(client, IGNORELIST_CHAN, SpecialChanType.IGNORELIST, data);
	},
};

export default ignorelist;
