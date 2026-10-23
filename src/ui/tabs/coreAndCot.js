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
import { meguminCotForMode, models } from "../../../data/cot/index.js";
import { card as pageCard, switchRow, esc, showModal } from "../controls.js";

// ── Page state, kept while SillyTavern is open ───────────────────────────

let currentPage = "preset";

export function renderCoreAndCot(c) {
    c.empty();
    const rerender = () => renderCoreAndCot(c);
    const customModes = extension_settings[extensionName].customModes || [];
    const official = hardcodedLogic.modes;
    const active = [...official, ...customModes].find(m => m.id === localProfile.mode);

    if (localProfile.cotEnabled === undefined) localProfile.cotEnabled = true;

    const cotEntry = models.find(m => m.id === localProfile.model);
    const cotLabel = cotEntry?.label || "None";

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
    if (currentPage === "preset") renderPresetPage($page, { official, customModes, rerender });
    else renderThinkingPage($page, { rerender });
}

// ── Preset page ──────────────────────────────────────────────────────────

function pickPreset(m) {
    localProfile.mode = m.id;
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

function renderPresetPage(c, { official, customModes, rerender }) {
    const pick = pageCard("Choose a preset");

    const $grid = $(`<div class="mtab-card-grid ptx-grid"></div>`);
    [...official, ...customModes].forEach(m => $grid.append(presetCard(m, { custom: customModes.some(cm => cm.id === m.id), rerender })));
    pick.append($grid);
    c.append(pick);
}

function engineText(m) {
    return [m.p1, m.p2, m.p3, m.p4, m.p5, m.p6].filter(Boolean).join("\n\n");
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
            if ($(e.target).closest(".igx-btn-view").length) return;
            if (localProfile.mode === m.id) return;
            pickPreset(m);
            rerender();
        });
    }

    const $viewBtn = $(`<button type="button" class="igx-btn-view" title="View engine text"><i class="fa-solid fa-eye"></i></button>`);
    $viewBtn.on("click", e => {
        e.stopPropagation();
        showModal({ title: `${esc(m.label)} — Engine`, text: engineText(m) });
    });
    $card.find(".ecard-title").append($viewBtn);

    return $card;
}

// ── Thinking page ────────────────────────────────────────────────────────

function renderThinkingPage(c, { rerender }) {
    const main = pageCard();
    main.append(switchRow({
        label: "Think before writing",
        desc: "The AI works the turn out on a scratchpad first, then writes the reply. Off: it writes the reply straight away.",
        on: localProfile.cotEnabled,
        onChange: on => { localProfile.cotEnabled = on; saveProfileToMemory(); rerender(); }
    }));
    c.append(main);
    if (!localProfile.cotEnabled) return;

    const prefix = `cot-${localProfile.mode}-`;
    const scoped = models.filter(m => m.id.startsWith(prefix));
    const visible = scoped.length ? scoped : models;

    const fw = pageCard("How it thinks", scoped.length ? "The frameworks made for your preset." : "Your preset works with any of these.");
    const $grid = $(`<div class="mtab-card-grid ptx-grid ptx-cot-grid"></div>`);
    visible.forEach(m => {
        const isSel = localProfile.model === m.id;
        const $card = $(`
            <div class="mtab-eng-card ptx-cot ${isSel ? "active" : ""}">
                <div class="ecard-accent"></div>
                <div class="ecard-body">
                    <div class="ecard-title"><span>${esc(m.label)}</span>
                        ${isSel ? `<span class="ecard-badge" style="background:rgba(168,85,247,0.15);color:#a855f7;"><i class="fa-solid fa-check"></i> Active</span>` : ""}
                    </div>
                    <p class="ecard-desc">${esc(m.desc)}</p>
                </div>
            </div>
        `);
        $card.on("click", e => {
            if ($(e.target).closest(".igx-btn-view").length) return;
            if (isSel) return;
            localProfile.model = m.id;
            saveProfileToMemory();
            rerender();
        });

        const $viewBtn = $(`<button type="button" class="igx-btn-view" title="View CoT text"><i class="fa-solid fa-eye"></i></button>`);
        $viewBtn.on("click", e => {
            e.stopPropagation();
            showModal({ title: `${esc(m.label)} — Chain of Thought`, text: m.content });
        });
        $card.find(".ecard-title").append($viewBtn);

        $grid.append($card);
    });
    fw.append($grid);
    c.append(fw);
}