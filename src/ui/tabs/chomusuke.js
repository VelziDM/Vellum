// ──────────────────────────────────────────────────────────────────────────────
// Chomusuke — the helper model.
//
// Runs background jobs on a second connection profile (SillyTavern Connection
// Profiles), so the story model never pauses or reloads presets.
//
// One page (plan 015): the on switch and the worker connection, then the jobs
// grouped by what they cost: "After every reply" (a call on every reply, with
// Combine calls and a live cost line) and "When the job runs" (occasional).
// ──────────────────────────────────────────────────────────────────────────────

import { localProfile } from "../../core/state.js";
import { saveProfileToMemory } from "../../core/profile.js";
import { fireRefreshHook, REFRESH } from "../../core/refreshHooks.js";
import {
    getSillyTavernConnectionProfiles,
    runWithChomusuke,
} from "../../engine/tasks.js";
import { generateQuietPrompt } from "../../st.js";
import { notebookEnabled } from "../../state/index.js";
import { card, esc } from "../controls.js";
import { CHOMUSUKE_SETUP_STEPS, CHOMUSUKE_SETUP_NOTE } from "../modelGuide.js";

// Folds stay as they were across redraws.
let advancedOpen = false;
// null = not touched yet: open while there's no profile to pick.
let setupOpen = null;

// After every reply: each is a call on every reply while on (off by default).
const PER_REPLY = [
    { key: "notebook", title: "The Notebook", icon: "fa-book", color: "#8b5cf6", defaultOff: true,
      desc: "Notes the clues each reply showed, who found out a hidden truth, and what came out. The story model only writes new truths.",
      note: "I recommend keeping this one for the story model to handle." }
];

// When the job runs: occasional, only when that job fires.
const OCCASIONAL = [
    { key: "memory", title: "Memory", icon: "fa-memory", color: "#3b82f6", desc: "Summarises older chat for the long-term vault." },
    { key: "banList", title: "Banned Phrases", icon: "fa-ban", color: "#ef4444", desc: "Finds the phrases the AI keeps repeating." },
    { key: "styleGen", title: "Writing Style generator", icon: "fa-wand-magic-sparkles", color: "#ec4899", desc: "Writes new writing styles from your tags." }
];

function ensureConfig() {
    if (!localProfile.chomusuke) {
        localProfile.chomusuke = {
            enabled: false, profileId: "", primaryProfileId: "",
            features: { memory: true, banList: true, styleGen: true },
        };
    }
    const cfg = localProfile.chomusuke;
    if (!cfg.features) cfg.features = {};
    return cfg;
}

// A route that costs a call per reply (defaultOff) is off unless switched on.
const routeOn = (cfg, feat) => feat.defaultOff ? cfg.features[feat.key] === true : cfg.features[feat.key] !== false;

/** Is the job itself switched on in its own tab? null = yes (or nothing to switch). */
function featureOff(key) {
    const p = localProfile;
    switch (key) {
        case "notebook": return notebookEnabled() ? null : { text: "The Notebook is off", tab: "notebook" };
        case "memory": return p.memoryCore && p.memoryCore.enabled ? null : { text: "Memory is off", tab: "memory" };
        default: return null;
    }
}

function offChip(key) {
    const off = featureOff(key);
    return off ? `<button type="button" class="chx-off" data-tab="${off.tab}" title="Open that tab">${esc(off.text)} <i class="fa-solid fa-arrow-right"></i></button>` : "";
}

/** How many Chomusuke calls a reply can cost right now. */
function callsPerReply(cfg) {
    return cfg.features.notebook === true && notebookEnabled() ? 1 : 0;
}

export function renderChomusuke(c) {
    c.empty();
    const cfg = ensureConfig();
    const redraw = () => renderChomusuke(c);
    const profiles = getSillyTavernConnectionProfiles();
    const worker = profiles.find(p => p.id === cfg.profileId);
    const running = Boolean(cfg.enabled && cfg.profileId);

    // ── Title + on/off ──
    const $head = $(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #f43f5e, #be123c);"><i class="fa-solid fa-cat"></i></div>
                <div><h2>Chomusuke</h2><p>Your helper model: it does the background jobs on a second connection, so the story model doesn't have to.</p></div>
            </div>
        </div>
    `);
    const $on = $(`<div class="mtab-toggle-row igx-switch igx-master ${cfg.enabled ? "active" : ""}">
        <div class="toggle-info"><div class="toggle-label">${cfg.enabled ? "Chomusuke on" : "Chomusuke off"}</div></div>
        <div class="ps-switch"></div>
    </div>`);
    $on.on("click", () => { cfg.enabled = !cfg.enabled; saveProfileToMemory(); redraw(); });
    $head.append($on);
    c.append($head);

    // ── Connection ──
    const conn = card("Worker connection", "The connection profile Chomusuke uses. A fast, cheap model works well: Claude Haiku, Gemini Flash, or a local 7B/8B.");
    if (!profiles.length) {
        conn.append(`<div class="igx-banner red"><i class="fa-solid fa-triangle-exclamation"></i>
            <span>No connection profiles yet. Make one in SillyTavern's connection settings first: the steps are below.</span></div>`);
    } else {
        const $line = $(`<div class="igx-inline chx-conn">
            <select id="chomusuke_worker_profile" class="ps-modern-input">
                <option value="">Pick a connection profile…</option>
                ${profiles.map(p => `<option value="${esc(p.id)}" ${p.id === cfg.profileId ? "selected" : ""}>${esc(p.name)} (${p.mode === "cc" ? "Chat" : "Text"})</option>`).join("")}
            </select>
            <button type="button" id="btn_test_chomusuke" class="menu_button igx-btn"><i class="fa-solid fa-vial"></i> Test</button>
        </div>`);
        conn.append($line);
        conn.append(`<div id="chomusuke_test_status" class="igx-note">${running ? `Ready on <b>${esc(worker ? worker.name : "your worker")}</b>.` : cfg.enabled ? "Pick a connection profile to start." : "Chomusuke is off: every job below uses your story model."}</div>`);

        // Advanced: where to go back to after a job.
        const $fold = $(`<button type="button" class="igx-fold"><i class="fa-solid fa-chevron-${advancedOpen ? "down" : "right"}"></i> Advanced</button>`);
        const $box = $(`<div class="igx-stack" style="display:${advancedOpen ? "flex" : "none"};">
            <div class="igx-field">
                <div class="igx-field-label">Go back to after each job <small>Automatic uses whatever profile was on before the job ran</small></div>
                <select id="chomusuke_primary_profile" class="ps-modern-input igx-narrow">
                    <option value="" ${!cfg.primaryProfileId ? "selected" : ""}>Automatic</option>
                    ${profiles.map(p => `<option value="${esc(p.id)}" ${p.id === cfg.primaryProfileId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}
                </select>
            </div>
        </div>`);
        $fold.on("click", () => {
            advancedOpen = !advancedOpen;
            $box.css("display", advancedOpen ? "flex" : "none");
            $fold.find("i").attr("class", `fa-solid fa-chevron-${advancedOpen ? "down" : "right"}`);
        });
        conn.append($fold).append($box);
    }

    // Step by step: making the connection profiles.
    const open = setupOpen === null ? !profiles.length : setupOpen;
    const $howFold = $(`<button type="button" class="igx-fold"><i class="fa-solid fa-chevron-${open ? "down" : "right"}"></i> How do I make a connection profile?</button>`);
    const $how = $(`<div class="chx-how" style="display:${open ? "flex" : "none"};">
        <div class="mtab-callout gold mgd-note"><i class="fa-solid fa-triangle-exclamation"></i><span>${CHOMUSUKE_SETUP_NOTE}</span></div>
        <ol class="chx-steps">${CHOMUSUKE_SETUP_STEPS.map(s => `<li>${s}</li>`).join("")}</ol>
    </div>`);
    $howFold.on("click", () => {
        setupOpen = $how.css("display") === "none";
        $how.css("display", setupOpen ? "flex" : "none");
        $howFold.find("i").attr("class", `fa-solid fa-chevron-${setupOpen ? "down" : "right"}`);
    });
    conn.append($howFold).append($how);
    c.append(conn);

    // ── After every reply ──
    const n = callsPerReply(cfg);
    const cost = !running ? "Chomusuke is off, so none of these cost a Chomusuke call."
        : n === 0 ? "No job runs after every reply right now."
        : n === 1 ? "Each reply costs <b>1</b> Chomusuke call."
        : `Each reply costs up to <b>${n}</b> Chomusuke calls.`;

    const every = card("After every reply", "Each job here is one Chomusuke call on every reply while it is on.");
    every.append(`<div class="chx-cost"><i class="fa-solid fa-receipt"></i> <span>${cost}</span></div>`);
    PER_REPLY.forEach(feat => {
        const on = routeOn(cfg, feat);
        const $row = routeRow(feat, on, offChip(feat.key));
        $row.on("click", e => {
            if ($(e.target).closest(".chx-off").length) return;
            cfg.features[feat.key] = !on;
            saveProfileToMemory();
            // The cost line depends on these: redraw.
            redraw();
        });
        every.append($row);
    });
    c.append(every);

    // ── When the job runs ──
    const occ = card("When the job runs", "Only when that job fires: a scan, a summary, a new direction.");
    const $grid = $(`<div class="chx-grid"></div>`);
    OCCASIONAL.forEach(feat => {
        const on = routeOn(cfg, feat);
        const $row = routeRow(feat, on, offChip(feat.key));
        $row.on("click", e => {
            if ($(e.target).closest(".chx-off").length) return;
            cfg.features[feat.key] = !on;
            saveProfileToMemory();
            redraw();
        });
        $grid.append($row);
    });
    occ.append($grid);
    c.append(occ);

    c.append(`<div class="igx-note chx-how"><i class="fa-solid fa-cat"></i> When a job starts, Chomusuke switches to the worker connection, does the job quietly, then switches back. If anything goes wrong, your story connection is put back straight away.</div>`);

    // ── Wiring ──
    c.find(".chx-off").on("click", function (e) {
        e.stopPropagation();
        fireRefreshHook(REFRESH.SWITCH_TAB, $(this).data("tab"));
    });
    c.find("#chomusuke_worker_profile").on("change", function () { cfg.profileId = $(this).val(); saveProfileToMemory(); redraw(); });
    c.find("#chomusuke_primary_profile").on("change", function () { cfg.primaryProfileId = $(this).val(); saveProfileToMemory(); });
    c.find("#btn_test_chomusuke").on("click", async function () {
        const $btn = $(this);
        const $status = c.find("#chomusuke_test_status");
        if (!cfg.profileId) { toastr.warning("Pick a connection profile first.", "Chomusuke"); return; }
        $btn.prop("disabled", true).html(`<i class="fa-solid fa-spinner fa-spin"></i> Testing…`);
        $status.text("Connecting to the worker…");
        try {
            const reply = await runWithChomusuke("test", async () => {
                const r = await generateQuietPrompt({ prompt: "Reply with the single word: OK", quietPrompt: "Reply with the single word: OK" });
                return typeof r === "string" ? r.trim() : "";
            }, { force: true });
            if (reply) {
                $status.html(`<span class="chx-ok"><i class="fa-solid fa-circle-check"></i> It works: the worker answered, and your story connection is back.</span>`);
                toastr.success("Chomusuke answered. Your story connection is back.", "Chomusuke");
            } else {
                $status.html(`<span class="chx-bad"><i class="fa-solid fa-circle-xmark"></i> The worker sent no text back. Your story connection is back.</span>`);
            }
        } catch (err) {
            $status.html(`<span class="chx-bad"><i class="fa-solid fa-circle-xmark"></i> The test failed: ${esc(err.message || err)}</span>`);
        } finally {
            $btn.prop("disabled", false).html(`<i class="fa-solid fa-vial"></i> Test`);
        }
    });
}

function routeRow(feat, on, chip) {
    return $(`
        <div class="mtab-toggle-row chx-route ${on ? "active" : ""}" data-feat="${feat.key}">
            <div class="toggle-info">
                <div class="toggle-label"><i class="fa-solid ${feat.icon}" style="color: ${feat.color}; margin-right: 6px;"></i> ${feat.title} ${chip}</div>
                <div class="toggle-desc">${feat.desc}</div>
                ${feat.note ? `<div class="chx-note"><i class="fa-solid fa-star"></i> ${feat.note}</div>` : ""}
            </div>
            <div class="ps-switch"></div>
        </div>
    `);
}
