import {expect} from "chai";
import {
	inputKind,
	installInputModality,
	isTouchInput,
	kindOf,
} from "../../client/js/helpers/inputModality";

describe("input modality (helpers/inputModality.ts)", function () {
	it("calls a finger touch and a mouse or a pen a pointer", function () {
		expect(kindOf("touch")).to.equal("touch");
		expect(kindOf("mouse")).to.equal("pointer");
		expect(kindOf("pen")).to.equal("pointer");
		expect(kindOf(""), "a synthetic event").to.equal(null);
		expect(kindOf(undefined)).to.equal(null);
	});

	it("follows the last pointer, whatever the device's primary input, and writes it on the root", function () {
		const listeners = new Map<string, (e: {pointerType: string}) => void>();
		const g = globalThis as Record<string, unknown>;
		g.window = {
			addEventListener: (type: string, fn: (e: {pointerType: string}) => void) =>
				listeners.set(type, fn),
		};

		try {
			const root = {dataset: {} as Record<string, string>};
			// A touchscreen laptop whose browser calls its primary input touch.
			installInputModality(root as unknown as HTMLElement, "touch");
			expect(root.dataset.input).to.equal("touch");
			expect(isTouchInput()).to.equal(true);

			listeners.get("pointermove")!({pointerType: "mouse"});
			expect(root.dataset.input, "the trackpad moved").to.equal("pointer");
			expect(inputKind()).to.equal("pointer");

			listeners.get("pointermove")!({} as {pointerType: string});
			expect(root.dataset.input, "a synthetic event changes nothing").to.equal("pointer");

			listeners.get("pointerdown")!({pointerType: "touch"});
			expect(root.dataset.input, "a finger on the screen").to.equal("touch");
		} finally {
			delete g.window;
		}
	});
});
