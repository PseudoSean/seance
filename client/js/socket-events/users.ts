import socket from "../socket";
import {store} from "../store";

socket.on("users", function (data) {
	if (store.state.activeChannel && store.state.activeChannel.channel.id === data.chan) {
		socket.emit("names", {
			target: data.chan,
		});
		return;
	}

	const channel = store.getters.findChannel(data.chan);

	if (channel) {
		channel.channel.usersOutdated = true;
	}
});
