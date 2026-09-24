/**
 * Minimal IndexedDB key/value store shared by the page and (via its own copy)
 * the service worker. Used for the webpush working stash — credentials the
 * service worker needs for quick-reply/mute/renewal — because a service
 * worker cannot read localStorage. Only written when the user enabled push
 * and password remembering; same origin, comparable exposure.
 */
const DB_NAME = "seance-push";
const STORE = "kv";

/** The IndexedDB factory in use. Tests swap it (the useStorageBackend
 * pattern) so they never patch a global — mocha runs with check-leaks. */
let factory: IDBFactory | null = null;

/** Swap the IndexedDB factory; null restores the browser's. */
export function useIDBFactory(next: IDBFactory | null): void {
	factory = next;
}

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = (factory ?? indexedDB).open(DB_NAME, 1);
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
