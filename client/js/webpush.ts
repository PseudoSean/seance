import {store} from "./store";

export default {togglePushSubscription};

// Web push needs a server to hold the subscription and send the pushes;
// there is none in client-only mode, so subscriptions are disabled and the
// service worker has no "push" handler. The worker is still registered
// because it provides the installable/offline PWA shell and click-to-open
// for in-browser notifications (see socket-events/msg.ts, which posts
// {type: "notification"} to the worker when `hasServiceWorker` is set).
//
// When a push relay exists (plan item D.11), this is where the
// PushManager.subscribe() call and the relay hand-off belong.

store.commit("pushNotificationState", "unsupported");

if (isAllowedServiceWorkersHost() && "serviceWorker" in navigator) {
	navigator.serviceWorker
		.register("service-worker.js", {scope: "./"})
		.then(() => navigator.serviceWorker.ready)
		.then((registration) => {
			// Only advertise the worker once it is active, so that the
			// notification path never posts to a worker that cannot answer.
			if (registration.active) {
				store.commit("hasServiceWorker");
			}
		})
		.catch((err) => {
			// Registration is best effort: without it the app still runs,
			// it just is not installable and notifications fall back to
			// `new Notification()` in the page.
			// eslint-disable-next-line no-console
			console.error("Service worker registration failed:", err);
		});
}

function togglePushSubscription() {
	// eslint-disable-next-line no-console
	console.warn("[webpush] push subscriptions are not available in client-only mode");
}

function isAllowedServiceWorkersHost() {
	// Secure contexts cover https:, localhost, and privileged custom schemes
	// such as the Electron shell's app://; the explicit hosts are a fallback
	// for browsers that don't expose isSecureContext.
	return (
		window.isSecureContext === true ||
		location.protocol === "https:" ||
		location.hostname === "localhost" ||
		location.hostname === "127.0.0.1" ||
		location.hostname === "[::1]"
	);
}
