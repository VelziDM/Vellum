// The chain-of-thought library, in display order.
//
// Exported as `models` because that is the key it occupies in hardcodedLogic and
// the name every reader downstream already uses. The folder is named cot/ because
// that is what these actually are — none of them describe an LLM model.

import { cot_prometheus } from "./prometheus.js";

export const models = [
    ...cot_prometheus,
];

// The chain a profile falls back to when its stored id is gone. Kept as one
// constant so the default can change in a single place: the profile repair, the
// engine mapping and the runtime resolver all read it.
export const DEFAULT_COT_ID = "cot-prometheus-phases-english";

/**
 * Which chain-of-thought an engine is written for.
 *
 * The mapping used to be an inline if/else chain inside the PRESETS tab's
 * click handler, which made it invisible to anything else that needed the same
 * answer -- and a clone needs it, to fill in its reasoning script. Two copies of
 * a mapping like this drift the moment a generation is added.
 */
export function meguminCotForMode(modeId, lang = "english") {
    if (!modeId) return null;
    if (modeId === "prometheus") return DEFAULT_COT_ID;
    return null;
}

/** The CoT entry an engine is written for, or null. */
export function meguminCotEntryForMode(modeId, lang = "english") {
    const id = meguminCotForMode(modeId, lang);
    return id ? models.find(m => m.id === id) || null : null;
}

/**
 * The stored id resolved to a real entry, or the default entry when the id is
 * empty or no longer exists. One place decides what "no such CoT" means, so a
 * deleted variant never leaves [[COT]] silently blank.
 */
export function meguminResolveCot(modelId) {
    return models.find(m => m.id === modelId)
        || models.find(m => m.id === DEFAULT_COT_ID)
        || models[0] || null;
}
