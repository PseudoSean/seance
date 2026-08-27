import {store} from "./store";

export default {togglePushSubscription};

// Web push needs a server to hold the subscription and send the pushes;
// there is none in client-only mode, so subscriptions are disabled and the
// service worker has no "push" handler. The worker itself is registered by
// pwa.ts (installable/offline shell, click-to-open for in-browser
// notifications — see socket-events/msg.ts, which posts {type: "notification"}
// to the worker when `hasServiceWorker` is set).
//
// When a push relay exists (plan item D.11), this is where the
// PushManager.subscribe() call and the relay hand-off belong.

store.commit("pushNotificationState", "unsupported");

function togglePushSubscription() {
	// eslint-disable-next-line no-console
	console.warn("[webpush] push subscriptions are not available in client-only mode");
}
