// ─────────────────────────────────────────────────────────────────────────────
// Settings — what is left of it.
//
// The tab used to carry the master switch, the two prompt previews, the log of
// background prompts, the lorebook switch and the author's card form. All of
// those are gone: the switch has no button anywhere, the previews and the log
// were ways to look at a prompt that is now written by hand, the lorebook has
// no background job to feed, and the form was the original author's.
//
// What is left is the save mode and the about card.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings, saveSettingsDebounced } from "../../st.js";
import { extensionName } from "../../core/constants.js";
import { initProfile } from "../../core/profile.js";
import { flushProfileSettingsToLoadedKey, _saveProfileDebouncedInner } from "../../core/profile.js";
import { cancelDebounce } from "../../st.js";

export function renderGlobalSettings(c) {
    c.empty();
    const gs = extension_settings[extensionName].globalSettings;

    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #64748b, #475569);">
                    <i class="fa-solid fa-gear"></i>
                </div>
                <div>
                    <h2>Settings</h2>
                    <p>Preferences that apply to every character and every chat.</p>
                </div>
            </div>
            <div class="mtab-header-badge" style="background: rgba(168,85,247,0.12); color: #a855f7; border: 1px solid rgba(168,85,247,0.25);">
                <i class="fa-solid fa-earth-americas" style="font-size:0.6rem;"></i> Saved globally
            </div>
        </div>
    `);

    const $content = $(`<div style="display:flex; flex-direction:column; gap:10px;"></div>`);

    // ── DATA ────────────────────────────────────────────────────────────────
    $content.append(`<div class="wstyle-section-head gold" style="margin-top:8px;"><i class="fa-solid fa-floppy-disk"></i> Data</div>`);
    $content.append(`
        <div class="mtab-panel" style="margin: 0; padding: 12px 16px;">
            <div class="mtab-setting-row" style="padding: 0; border: none;">
                <div class="set-info">
                    <div class="set-label"><i class="fa-solid fa-floppy-disk" style="color: var(--gold);"></i> Profile Save Mode</div>
                    <div class="set-desc"><b>Per Character</b> shares your settings across every chat with that character. <b>Per Chat</b> keeps each chat and each branch on its own settings.</div>
                </div>
                <select id="gs_save_mode" class="ps-modern-input" style="width: 180px; cursor: pointer;">
                    <option value="character" ${gs.saveMode === 'character' ? 'selected' : ''}>Per Character (Default)</option>
                    <option value="chat" ${gs.saveMode === 'chat' ? 'selected' : ''}>Per Chat</option>
                </select>
            </div>
        </div>
    `);

    // ── ABOUT ───────────────────────────────────────────────────────────────
    $content.append(`<div class="wstyle-section-head green" style="margin-top:8px;"><i class="fa-solid fa-circle-info"></i> About</div>`);
    $content.append(`
        <div class="mtab-panel gs-about" style="margin: 0;">
            <div class="gs-about-title">Vellum</div>
            <div class="gs-about-by">Personal fork — no external dependencies</div>
        </div>
    `);

    $content.find("#gs_save_mode").on("change", function () {
        // getCharacterKey() reads saveMode, so changing it moves where a save lands. Get any
        // pending edit written under the key it was made on before the switch, otherwise
        // initProfile() below replaces localProfile and that edit either dies or, worse,
        // gets saved under the new mode's key later.
        cancelDebounce(_saveProfileDebouncedInner);
        flushProfileSettingsToLoadedKey();
        gs.saveMode = $(this).val();
        saveSettingsDebounced();
        initProfile(); // Immediately reloads the correct profile
        toastr.success(`Save mode changed to Per ${gs.saveMode === 'chat' ? 'Chat' : 'Character'}.`);
    });

    c.append($content);
}
