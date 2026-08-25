import {store} from "../store";
import socket from "../socket";

// Socket.IO connect/disconnect/reconnect handling used to live here. The
// bus has no transport yet, so only the two contract-level events remain.
// Real connection state will arrive with the IRC transport in a later phase.

socket.on("connecting", function () {
	store.commit("currentUserVisibleError", "Connecting…");
	updateLoadingMessage();
});

socket.on("error", function (data) {
	const message = String(data?.message || data);

	store.commit("isConnected", false);
	store.commit("currentUserVisibleError", `Connection error: ${message}`);
	updateLoadingMessage();
});

function updateLoadingMessage() {
	const loading = document.getElementById("loading-page-message");

	if (loading) {
		loading.textContent = store.state.currentUserVisibleError;
	}
}
