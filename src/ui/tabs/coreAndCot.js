// ─────────────────────────────────────────────────────────────────────────────
// Preset & Thinking (plan 014) — which preset tells the story, how it thinks
// before it writes, and the story's standing settings (Story Config).
//
// Same layout as the Images tab: a summary row, then pages picked at the top
// (Preset · Thinking · Story Config). Built from the shared controls
// (ui/controls.js) and the preset cards.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings } from "../../st.js";
import { extensionName } from "../../core/constants.js";
import { localProfile } from "../../core/state.js";
import { saveProfileToMemory } from "../../core/profile.js";
import { hardcodedLogic } from "../../../data/database.js";
import { meguminCotForMode } from "../../../data/cot/index.js";
import { card as pageCard, segmented, switchRow, field, esc } from "../controls.js";

// ── Data ─────────────────────────────────────────────────────────────────

// The reasoning frameworks, in display order. One per engine: a framework is
// written for the engine it reasons for, so the list grows with the engines.
const COT_TYPES = [
    { id: "prometheus", label: "CoT Prometheus", desc: "The reasoning script Prometheus works through before it writes the turn." }
];

// Which reasoning set a CoT id is, and its language.
function parseCot(model) {
    const m = String(model || "");
    if (m.startsWith("cot-prometheus-")) return { type: "prometheus", lang: "english" };
    return { type: "off", lang: "english" };
}

// The frameworks made for a preset; null = any (older and your own presets).
function cotTypesFor(mode) {
    if (String(mode || "") === "prometheus") return ["prometheus"];
    return null;
}

function cotModelId(type, lang) {
    return `cot-${type}-english`;
}

// ── Page state, kept while SillyTavern is open ───────────────────────────

let currentPage = "preset";
// null until the tab is first opened: then the list that holds your preset.
let presetFilter = null;
let advancedOpen = false;

export function renderCoreAndCot(c) {
    c.empty();
    const rerender = () => renderCoreAndCot(c);
    const customModes = extension_settings[extensionName].customModes || [];
    const official = hardcodedLogic.modes;
    const active = [...official, ...customModes].find(m => m.id === localProfile.mode);
    const activeIsCustom = customModes.some(m => m.id === localProfile.mode);

    if (localProfile.cotEnabled === undefined) localProfile.cotEnabled = true;
    const cot = parseCot(localProfile.model);
    const cotLabel = (COT_TYPES.find(t => t.id === cot.type) || {}).label || "None";

    // ── Header + summary ──
    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #f59e0b, #a855f7);"><i class="fa-solid fa-server"></i></div>
                <div><h2>Preset & Thinking</h2><p>Choose the preset and how it thinks before it writes.</p></div>
            </div>
        </div>
        <div class="igx-chips ptx-summary">
            <span class="igx-chip ok"><i class="fa-solid fa-server"></i> ${esc(active ? active.label : localProfile.mode)}</span>
            <span class="igx-chip ${localProfile.cotEnabled ? "warm" : ""}"><i class="fa-solid fa-brain"></i> Thinking: ${localProfile.cotEnabled ? esc(cotLabel) : "off"}</span>
        </div>
    `);

    const pages = [
        { id: "preset", label: "Preset", icon: "fa-server" },
        { id: "thinking", label: "Thinking", icon: "fa-brain" }
    ];
    const $tabs = $(`<div class="igx-tabs" role="tablist"></div>`);
    pages.forEach(p => {
        const $b = $(`<button type="button" class="${p.id === currentPage ? "on" : ""}"><i class="fa-solid ${p.icon}"></i> ${p.label}</button>`);
        $b.on("click", () => { if (currentPage !== p.id) { currentPage = p.id; rerender(); } });
        $tabs.append($b);
    });
    c.append($tabs);

    const $page = $(`<div class="igx-page"></div>`);
    c.append($page);
    if (currentPage === "preset") renderPresetPage($page, { active, activeIsCustom, official, customModes, rerender });
    else renderThinkingPage($page, { active, cot, rerender });
}

// ── Preset page ──────────────────────────────────────────────────────────

function pickPreset(m) {
    localProfile.mode = m.id;
    // The preset→thinking mapping lives in data/cot/index.js, so a custom
    // clone fills its reasoning script from the same source.
    const targetCot = meguminCotForMode(m.id, "english");
    if (targetCot) localProfile.model = targetCot;
    saveProfileToMemory();
}

function badgesFor(m, isLocked) {
    let b = "";
    if (m.recommended) b += `<span class="ecard-badge rec"><i class="fa-solid fa-star"></i> Recommended</span>`;
    if (m.isNew && !isLocked) b += `<span class="ecard-badge new">New</span>`;
    if (isLocked) b += `<span class="ecard-badge locked"><i class="fa-solid fa-lock"></i> Coming Soon</span>`;
    return b;
}

function renderPresetPage(c, { active, activeIsCustom, official, customModes, rerender }) {
    // ── Choose a preset ──
    if (!presetFilter) presetFilter = activeIsCustom ? "mine" : "all";
    const pick = pageCard("Choose a preset");
    pick.append(segmented([
        { id: "all", label: `Preset (${official.length})` },
        { id: "mine", label: `Mine (${customModes.length})` }
    ], presetFilter, id => { presetFilter = id; rerender(); }));

    const $grid = $(`<div class="mtab-card-grid ptx-grid"></div>`);
    if (presetFilter === "mine") {
        if (!customModes.length) $grid.append(`<div class="igx-note">No presets of your own yet.</div>`);
        customModes.forEach(m => $grid.append(presetCard(m, { custom: true, rerender })));
    } else {
        official.forEach(m => $grid.append(presetCard(m, { custom: false, rerender })));
    }
    pick.append($grid);
    c.append(pick);
}

function presetCard(m, { custom, rerender }) {
    const isLocked = !custom && m.locked === true;
    const isSel = localProfile.mode === m.id;
    const badges = custom ? "" : badgesFor(m, isLocked);
    const $card = $(`
        <div class="mtab-eng-card ptx-compact ${isSel ? "active" : ""} ${isLocked ? "locked-card" : ""}">
            <div class="ecard-accent"></div>
            <div class="ecard-body">
                <div class="ecard-title">
                    <span>${esc(m.label)}</span>
                    ${isSel ? `<span class="ecard-badge" style="background:rgba(16,185,129,0.15);color:#10b981;"><i class="fa-solid fa-check"></i> Active</span>` : ""}
                </div>
                <p class="ecard-desc">${custom ? "One of your own presets." : (m.desc || "")}</p>
                ${badges ? `<div class="ptx-badges">${badges}</div>` : ""}
            </div>
        </div>
    `);
    if (!isLocked) {
        $card.on("click", e => {
            if (localProfile.mode === m.id) return;
            pickPreset(m);
            rerender();
        });
    }
    return $card;
}

// ── Thinking page ────────────────────────────────────────────────────────

function renderThinkingPage(c, { active, cot, rerender }) {
    const main = pageCard();
    main.append(switchRow({
        label: "Think before writing",
        desc: "The AI works the turn out on a scratchpad first, then writes the reply. Off: it writes the reply straight away.",
        on: localProfile.cotEnabled,
        onChange: on => { localProfile.cotEnabled = on; saveProfileToMemory(); rerender(); }
    }));
    c.append(main);
    if (!localProfile.cotEnabled) return;

    // ── Framework ──
    const allowed = cotTypesFor(localProfile.mode);
    const fw = pageCard("How it thinks", allowed ? "The frameworks made for your preset." : "Your preset works with any of these.");
    const visible = COT_TYPES.filter(t => !allowed || allowed.includes(t.id) || t.id === cot.type);
    const $grid = $(`<div class="mtab-card-grid ptx-grid ptx-cot-grid"></div>`);
    visible.forEach(t => {
        const isSel = cot.type === t.id;
        const warned = allowed && !allowed.includes(t.id);
        const badge = warned
            ? `<span class="ecard-badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;"><i class="fa-solid fa-triangle-exclamation"></i> Made for another preset</span>`
            : "";
        const $card = $(`
            <div class="mtab-eng-card ptx-cot ${isSel ? "active" : ""}">
                <div class="ecard-accent"></div>
                <div class="ecard-body">
                    <div class="ecard-title"><span>${t.label}</span>
                        ${isSel ? `<span class="ecard-badge" style="background:rgba(168,85,247,0.15);color:#a855f7;"><i class="fa-solid fa-check"></i> Active</span>` : ""}
                    </div>
                    <p class="ecard-desc">${t.desc}</p>
                    ${badge ? `<div class="ptx-badges">${badge}</div>` : ""}
                </div>
            </div>
        `);
        $card.on("click", () => {
            if (isSel) return;
            localProfile.model = cotModelId(t.id, cot.lang);
            saveProfileToMemory();
            rerender();
        });
        $grid.append($card);
    });
    fw.append($grid);
    c.append(fw);

    // ── Length ──
    if (!localProfile.thinkEffort) localProfile.thinkEffort = "unspecified";
    if (!localProfile.customThinkEffort) localProfile.customThinkEffort = "100";
    const len = pageCard("How long it thinks");
    const $custom = field("Words", "", $(`<input type="number" id="ps_input_custom_effort" class="ps-modern-input igx-tiny" min="1" value="${esc(localProfile.customThinkEffort)}" />`));
    $custom.toggle(localProfile.thinkEffort === "custom");
    len.append(segmented([
        { id: "100", label: "100 words" }, { id: "250", label: "250 words" }, { id: "450", label: "450 words" },
        { id: "custom", label: "Custom" }, { id: "unspecified", label: "No limit" }
    ], localProfile.thinkEffort, id => {
        localProfile.thinkEffort = id;
        saveProfileToMemory();
        $custom.toggle(id === "custom");
    }));
    $custom.find("input").on("change input", function () { localProfile.customThinkEffort = $(this).val(); saveProfileToMemory(); });
    len.append($custom);
    c.append(len);

    // ── Advanced ──
    if (localProfile.thinkingV2 === undefined) localProfile.thinkingV2 = false;
    const adv = pageCard();
    const $fold = $(`<button type="button" class="igx-fold"><i class="fa-solid fa-chevron-${advancedOpen ? "down" : "right"}"></i> Advanced</button>`);
    const $box = $(`<div class="igx-stack" style="display:${advancedOpen ? "flex" : "none"};"></div>`);
    $fold.on("click", () => {
        advancedOpen = !advancedOpen;
        $box.css("display", advancedOpen ? "flex" : "none");
        $fold.find("i").attr("class", `fa-solid fa-chevron-${advancedOpen ? "down" : "right"}`);
    });
    $box.append(switchRow({
        label: "Gemini thinking override",
        desc: "Only for Gemini models: adds the tags Gemini needs for its thinking.",
        on: localProfile.thinkingV2,
        onChange: on => { localProfile.thinkingV2 = on; saveProfileToMemory(); }
    }));
    adv.append($fold).append($box);
    c.append(adv);
}
