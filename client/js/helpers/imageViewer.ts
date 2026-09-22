// The image viewer's open state lives in a component ref (App.vue provides it
// to LinkPreview), which non-Vue code — the Android shell's back button in
// native.ts — cannot reach. While an image is open, ImageViewer.vue registers
// its close function here; closeOpenImage() closes it and reports whether
// there was anything to close.

let close: (() => void) | null = null;

export function setImageViewerClose(fn: (() => void) | null): void {
	close = fn;
}

export function closeOpenImage(): boolean {
	if (!close) {
		return false;
	}

	close();
	return true;
}
