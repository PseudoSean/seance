/**
 * Tells Prism's core to stay out of the page.
 *
 * The core reads `manual` off the global `Prism` object as it loads, so this
 * has to run before it does — which is why it is a module of its own: `import`
 * statements are hoisted, and a bare assignment above one would run too late.
 * Without it Prism scans the document for `language-*` elements after load; we
 * highlight from the layout tree instead, and it would find nothing.
 */

type PrismGlobal = {manual?: boolean; disableWorkerMessageHandler?: boolean};

const scope = globalThis as unknown as {Prism?: PrismGlobal};

scope.Prism = {...scope.Prism, manual: true, disableWorkerMessageHandler: true};

export {};
