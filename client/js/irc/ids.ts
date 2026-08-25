/**
 * Id allocation for channels and messages.
 *
 * The UI assumes channel ids are unique across every network (`findChannel`,
 * the `#/chan-<id>` route) and that message ids increase monotonically across
 * every channel (unread marker, `more.lastId`, mention dedupe). One shared
 * allocator therefore serves all {@link IrcClient} instances; tests can pass
 * their own to get deterministic numbers.
 */
export class IdAllocator {
	private nextChan: number;
	private nextMsg: number;

	constructor(firstChanId = 1, firstMsgId = 1) {
		this.nextChan = firstChanId;
		this.nextMsg = firstMsgId;
	}

	/** Allocate a channel id (never 0: `join.index` and `open` treat 0 as "none"). */
	chanId(): number {
		return this.nextChan++;
	}

	msgId(): number {
		return this.nextMsg++;
	}
}

/** Allocator shared by every network in the running app. */
export const sharedIds = new IdAllocator();
