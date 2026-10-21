// Identity constants. Kept apart from state.js because these never change at
// runtime, and because almost every module wants extensionName for the
// extension_settings lookup — importing that shouldn't drag mutable state along.

export const extensionName = "Vellum";

// Where the extension's own files live: the folder it is installed in, plus the
// images that ship with it.
//
// Derived from this file's own URL rather than from the extension's name, so
// the folder can be called anything — "Vellum", "vellum-beta", a fork's name —
// and the images still resolve. The old path was
// `scripts/extensions/third-party/${extensionName}`, which broke the moment the
// folder was renamed.
export const extensionFolderPath = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
