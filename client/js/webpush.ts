import {store} from "./store";

export default {togglePushSubscription};

// Web push needs a server to hold the subscription and send the pushes;
// there is none in client-only mode, so subscriptions are disabled. The
// service worker is still registered because it provides the installable
// PWA shell and click-to-open for browser notifications.

if (isAllowedServiceWorkersHost() && "serviceWorker" in navigator) {
	navigator.serviceWorker
		.register("service-worker.js")
		.then(() => {
			store.commit("hasServiceWorker");
		})
		.catch((err) => {
			console.error(err); // eslint-disable-line no-console
		});
}

store.commit("pushNotificationState", "unsupported");

function togglePushSubscription() {
	// eslint-disable-next-line no-console
	console.warn("[webpush] push subscriptions are not available in client-only mode");
}

function isAllowedServiceWorkersHost() {
	return (
		location.protocol === "https:" ||
		location.hostname === "localhost" ||
		location.hostname === "127.0.0.1"
	);
}
