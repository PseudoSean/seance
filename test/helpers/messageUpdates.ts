import {expect} from "chai";
import {insertMessage, removePending} from "../../client/js/helpers/messageUpdates";
import type {SharedMsg} from "../../shared/types/msg";

function msg(id: number, pending = false): SharedMsg {
	return {id, time: new Date(id * 1000), users: [], ...(pending ? {pending: true} : {})};
}

function ids(messages: SharedMsg[]): number[] {
	return messages.map((m) => m.id);
}

describe("Pending messages in the message list (helpers/messageUpdates.ts)", function () {
	describe("insertMessage", function () {
		it("appends when nothing is pending", function () {
			const messages = [msg(1), msg(2)];
			insertMessage(messages, msg(3));
			expect(ids(messages)).to.deep.equal([1, 2, 3]);
		});

		it("keeps a pending message at the bottom", function () {
			const messages = [msg(1), msg(2, true)];
			insertMessage(messages, msg(3));
			expect(ids(messages)).to.deep.equal([1, 3, 2]);
		});

		it("puts a new pending message after the ones already waiting", function () {
			const messages = [msg(1), msg(2, true)];
			insertMessage(messages, msg(3, true));
			expect(ids(messages)).to.deep.equal([1, 2, 3]);
		});

		it("inserts before the whole trailing pending block", function () {
			const messages = [msg(1), msg(2, true), msg(3, true)];
			insertMessage(messages, msg(4));
			expect(ids(messages)).to.deep.equal([1, 4, 2, 3]);
		});

		it("only looks at the trailing block", function () {
			const messages = [msg(1, true), msg(2)];
			insertMessage(messages, msg(3));
			expect(ids(messages)).to.deep.equal([1, 2, 3]);
		});

		it("works on an empty list", function () {
			const messages: SharedMsg[] = [];
			insertMessage(messages, msg(1, true));
			insertMessage(messages, msg(2));
			expect(ids(messages)).to.deep.equal([2, 1]);
		});
	});

	describe("removePending", function () {
		it("removes the pending message with that id", function () {
			const messages = [msg(1), msg(2, true), msg(3, true)];
			expect(removePending(messages, 2)).to.equal(true);
			expect(ids(messages)).to.deep.equal([1, 3]);
		});

		it("leaves a message that is not pending alone", function () {
			const messages = [msg(1), msg(2)];
			expect(removePending(messages, 1)).to.equal(false);
			expect(ids(messages)).to.deep.equal([1, 2]);
		});

		it("reports a miss", function () {
			const messages = [msg(1), msg(2, true)];
			expect(removePending(messages, 9)).to.equal(false);
			expect(ids(messages)).to.deep.equal([1, 2]);
		});
	});
});
