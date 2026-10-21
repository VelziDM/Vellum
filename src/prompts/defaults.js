// ─────────────────────────────────────────────────────────────────────────────
// The built-in prompt set, reassembled from one file per module.
//
// DEFAULT_PROMPTS has exactly the shape it always had, so every reader
// downstream is unchanged. The split exists so editing one module's prompts
// doesn't mean scrolling past every other module's rules.
// ─────────────────────────────────────────────────────────────────────────────

import { banListPrompts } from "./banList.js";
import { memoryCorePrompts } from "./memoryCore.js";

export const DEFAULT_PROMPTS = {
    banList: banListPrompts,
    memoryCore: memoryCorePrompts,
};

// The modules whose prompts live under `profile[mod].customPrompts`.
//
// banList is deliberately absent: its overrides are stored one level up, on
// `profile.banListCustomPrompts`, so the sparsify/rehydrate helpers handle it as
// a separate case rather than in this loop.
export const MEGUMIN_PROMPT_MODULES = ['memoryCore'];
