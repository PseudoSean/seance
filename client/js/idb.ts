/**
 * Minimal IndexedDB key/value store shared by the page and (via its own copy)
 * the service worker. Used for the webpush working stash — credentials the
 * service worker needs for quick-reply/mute/renewal — because a service
 * worker cannot read localStorage. Only written when the user enabled push
 * and password remembering; same origin, comparable exposure.
 */
const DB_NAME = "seance-push";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function idbSet(key: string, value: unknown): Promise<void> {
	const db = await open();

	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readwrite");
		tx.objectStore(STORE).put(value, key);

		tx.oncomplete = () => {
			db.close();
			resolve();
		};

		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
	const db = await open();

	return new Promise((resolve, reject) => {
		const req = db.transaction(STORE).objectStore(STORE).get(key);

		req.onsuccess = () => {
			db.close();
			resolve(req.result as T | undefined);
		};

		req.onerror = () => {
			db.close();
			reject(req.error);
		};
	});
}
