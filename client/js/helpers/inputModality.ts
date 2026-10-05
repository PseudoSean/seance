/**
 * Which kind of pointer the user is using right now, as opposed to what the
 * device is (helpers/device.ts). `(hover: none)` and `(pointer: coarse)`
 * describe the *primary* input, which a laptop with a touchscreen may report
 * as touch while its owner works with a trackpad: the message toolbar's
 * hover was then switched off for the trackpad, and the long press that
 * stood in for it listens only to a finger. So the last pointer decides:
 * `data-input="touch"` on <html> after a finger, `"pointer"` after a mouse
 * or a pen. The hover toolbar follows the mouse, the long press the finger,
 * whichever the browser calls primary. Vue-free; the listeners are passive.
 */

export type InputKind = "touch" | "pointer";

let current: InputKind = "pointer";

/** The kind of the last pointer seen (before any, the device's primary). */
export function inputKind(): InputKind {
	return current;
}

/** Whether the last pointer was a finger. */
export function isTouchInput(): boolean {
	return current === "touch";
}

/**
 * The kind a pointer event's `pointerType` stands for; null for anything
 * else (a synthetic event, which carries none, says nothing about the user).
 */
export function kindOf(pointerType: string | undefined): InputKind | null {
	if (pointerType === "touch") {
		return "touch";
	}

	return pointerType === "mouse" || pointerType === "pen" ? "pointer" : null;
}

/**
 * Starts following the pointer. `initial` is the device's primary input
 * (hasVirtualKeyboard), until the first pointer says otherwise.
 */
export function installInputModality(root: HTMLElement, initial: InputKind): void {
	const set = (kind: InputKind) => {
		current = kind;
		root.dataset.input = kind;
	};

	set(initial);

	const onPointer = (e: PointerEvent) => {
		const kind = kindOf(e.pointerType);

		if (kind && kind !== current) {
			set(kind);
		}
	};

	for (const type of ["pointerdown", "pointermove"] as const) {
		window.addEventListener(type, onPointer, {capture: true, passive: true});
	}
}
