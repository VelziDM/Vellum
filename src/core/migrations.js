// ─────────────────────────────────────────────────────────────────────────────
// One-time repairs to stored settings.
//
// Everything here is subtractive and idempotent: it fixes data written by older
// builds and does nothing on a profile that is already current. Nothing in here
// is part of normal operation, which is exactly why it does not belong inline.
//
// Two further migrations (the memory vault rebuild and the legacy block-id sync)
// are still in index.js — they depend on the memory and blocks features, which
// are not modules yet. They land here once those move.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, saveSettingsDebounced } from "../st.js";
import { extensionName } from "./constants.js";

// The extension was renamed. Everything it stores lives under one key of
// extension_settings, and that key was the old name -- so a rename that did not
// carry the data would leave every profile, every memory and every style
// behind under a key nothing reads any more.
//
// The old key is written out in full on purpose: the constant no longer holds
// it, and a rename is exactly the moment to stop deriving one from the other.
const OLD_EXTENSION_NAME = "Megumin-Suite-Beta";

/**
 * Move the stored settings to the new key. Runs first, before every other
 * migration, because they all read the current key.
 */
export function migrateExtensionName() {
    const store = extension_settings;
    if (!store) return;
    const old = store[OLD_EXTENSION_NAME];
    if (!old) return;

    if (!store[extensionName]) {
        store[extensionName] = old;
        delete store[OLD_EXTENSION_NAME];
        saveSettingsDebounced();
        console.log(`[${extensionName}] Settings moved from "${OLD_EXTENSION_NAME}" to "${extensionName}".`);
        return;
    }

    // Both keys exist: the new one was already written by a later run, so the
    // old one is stale. It is left in place rather than merged -- merging two
    // profile stores field by field is where data gets lost.
    console.warn(`[${extensionName}] Both "${OLD_EXTENSION_NAME}" and "${extensionName}" hold settings. The old one is left untouched; the current one is used.`);
}

export function cleanLegacySettings() {
    if (!extension_settings[extensionName] || !extension_settings[extensionName].profiles) return;
    let didClean = false;
    Object.keys(extension_settings[extensionName].profiles).forEach(key => {
        if (key === 'default') return; // Do not touch global defaults
        const prof = extension_settings[extensionName].profiles[key];
        if (prof.memoryCore && (prof.memoryCore.shortTermChunks?.length > 0 || prof.memoryCore.longTermVault?.length > 0)) {
            delete prof.memoryCore.shortTermChunks;
            delete prof.memoryCore.longTermVault;
            didClean = true;
        }
        if (prof.storyPlan && (prof.storyPlan.currentPlan || prof.storyPlan.lastTrackerState)) {
            prof.storyPlan.currentPlan = "";
            prof.storyPlan.lastTrackerState = "";
            didClean = true;
        }
    });
    if (didClean) saveSettingsDebounced();
}

// Looks (Image Gen character tags) live in each chat's file. One Beta build kept them in
// settings.json for a day, and global sync copied that one chat's looks into every
// profile; the copies are stale, never read any more, and only add weight.
export function dropLookResidue() {
    const profiles = extension_settings[extensionName] && extension_settings[extensionName].profiles;
    if (!profiles) return;
    let dropped = 0;
    for (const p of Object.values(profiles)) {
        if (p && p.imageGen && Object.prototype.hasOwnProperty.call(p.imageGen, "characterTags")) {
            delete p.imageGen.characterTags;
            dropped++;
        }
    }
    if (dropped) {
        console.log(`[${extensionName}] Removed stale image looks from ${dropped} profile(s) in settings.`);
        saveSettingsDebounced();
    }
}

// The utility prefill toggle, the Dynamic Ban List and the global-sync map are
// gone. All three left live keys: the prefill switches in globalSettings, the
// ban list's keys on every profile, and the map of "which tabs travel". Nothing
// reads any of them; dead keys in settings.json are the trap
// localProfile.devOverrides already was -- so they are deleted rather than left
// to be found and half-wired back up later.
export function migrateRemovedFeatureKeys() {
    const store = extension_settings[extensionName];
    if (!store) return;
    let changed = false;
    const gs = store.globalSettings;
    if (gs) {
        ["disableUtilityPrefill", "enableUtilityPrefill"].forEach(k => {
            if (Object.prototype.hasOwnProperty.call(gs, k)) { delete gs[k]; changed = true; }
        });
    }
    if (store.globalSyncTabs) { delete store.globalSyncTabs; changed = true; }
    const profiles = store.profiles;
    if (profiles) {
        for (const p of Object.values(profiles)) {
            ["banList", "banListBackend", "banListCustomPrompts", "banListCustomPromptsEnabled"].forEach(k => {
                if (p && Object.prototype.hasOwnProperty.call(p, k)) { delete p[k]; changed = true; }
            });
        }
    }
    if (changed) saveSettingsDebounced();
}
