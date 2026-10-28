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
        // The prefill switches, the two prompt previews, the background-prompt
        // settings, the lorebook switch and the master switch are all gone with
        // their features. The master switch is turned ON for anyone who had it
        // off: it has no button any more, so a stored "off" would leave the
        // extension silently doing nothing.
        ["disableUtilityPrefill", "enableUtilityPrefill",
            "promptPreview", "bgPreview", "bgPreviewJobs", "loreInTasks",
            "settingsNoticeSeen"].forEach(k => {
            if (Object.prototype.hasOwnProperty.call(gs, k)) { delete gs[k]; changed = true; }
        });
        if (gs.suiteEnabled === false) { gs.suiteEnabled = true; changed = true; }
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
