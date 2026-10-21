// ─────────────────────────────────────────────────────────────────────────────
// hardcodedLogic — the extension's built-in content library.
//
// Two things live here now: the engines and their chains of thought. The
// writing-style library went with the Writing Style tab, and the story
// config went with its own panel.
//
// Import sites keep working:
//     import { hardcodedLogic } from "./data/database.js";
// ─────────────────────────────────────────────────────────────────────────────

import { modes } from "./modes/index.js";
import { models } from "./cot/index.js";

export const hardcodedLogic = {
    modes,
    models,
};

// Section-level exports, for code that wants one list without the whole library.
export { modes, models };
