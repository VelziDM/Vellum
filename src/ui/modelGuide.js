// ────────────────────────────────────────────────────────────────────────────
// Model guide: the popup behind "Model guide" in Preset & Thinking. Which
// settings fit which model, and the one rule for everything else: turn on only
// what the story needs. The Kimi and DeepSeek advice comes from
// docs/research-kimi-overthinking.md.
// ────────────────────────────────────────────────────────────────────────────

import { Popup, POPUP_TYPE } from "../st.js";
import { fireRefreshHook, REFRESH } from "../core/refreshHooks.js";
import { extensionFolderPath } from "../core/constants.js";

const MODELS = [
    {
        icon: "fa-gem", name: "Gemini",
        tips: [
            "Turn on <b>Gemini thinking override</b> (Thinking page, under Advanced) and the <b>prefill</b> in the preset JSON."
        ]
    },
    {
        icon: "fa-dragon", name: "Chinese models", models: "Kimi, DeepSeek, GLM, Qwen",
        tips: [
            "They think a lot. A temperature of <b>0.7–0.8</b> helps them think less, and a word limit on the thinking (Thinking page) puts a ceiling on it.",
            "Kimi ignores Reasoning Effort: it only thinks or doesn't. If it still thinks too long, turn its thinking off in SillyTavern's connection settings if you want."
        ]
    },
    {
        icon: "fa-server", name: "DeepSeek and local models",
        tips: [
            "<b>DeepSeek:</b> set up <b>Chomusuke</b> and let the worker model do the memory work after the reply, so the story model keeps its attention on the story. It can use the same connection as your story.",
            "<b>Local models:</b> use Chomusuke the same way."
        ],
        action: { id: "chomusuke", label: "Open Chomusuke" }
    }
];

// How to make the connection profiles Chomusuke switches between. Also shown
// in the Chomusuke tab. A profile for the story too: after a job, Chomusuke
// switches back to the profile that was on, so the story needs one.
// Shown before the steps: a profile saved with its presets reloads the chat
// every time Chomusuke switches to it or back.
export const CHOMUSUKE_SETUP_NOTE = "<b>Before you start:</b> when you save a profile, <b>uncheck Settings Preset and Regex Preset</b>. Otherwise the chat reloads every time Chomusuke switches. Already have profiles saved with them? Make new ones the same way.";

export const CHOMUSUKE_SETUP_STEPS = [
    "Open SillyTavern's <b>API Connections</b> panel (the plug icon in the top bar).",
    "Connect your story model as usual. Then, at the top of the panel under <b>Connection Profile</b>, click <b>Create a new connection profile</b> (the page with a +), name it <b>Story</b> and save. Keep this profile picked while you play.",
    "Want Chomusuke on the same model (DeepSeek, local models)? You're done here: pick <b>Story</b> in step 5.",
    "For another model: in the same panel, connect the model Chomusuke should use (API, key, model, Connect), create a new connection profile again and name it <b>Chomusuke</b>. Then pick your <b>Story</b> profile again.",
    "In the <b>Chomusuke</b> tab, turn Chomusuke on, pick the profile under <b>Worker connection</b> and press <b>Test</b>.",
    "Turn on the jobs you want it to do, for example the <b>memory summary</b>."
];

const PRACTICES = [
    "<b>Turn on only what your story needs.</b> Every helper adds to what the model reads each turn, and some add a call after every reply. Start with the preset, its thinking and the story's standing settings, and add more when you miss them.",
    "<b>Keep the memory in the short term</b> until the story is long enough for the vault to be worth it: a summary of a summary loses the details a scene needs."
];

export async function openModelGuide() {
    const $root = $(`
        <div class="mgd">
            <div class="mgd-head">
                <h3><i class="fa-solid fa-compass"></i> Which settings fit my model?</h3>
                <p>A short guide to getting the most out of the suite with the model you use.</p>
            </div>
            <div class="mgd-models"></div>
            <h4 class="mgd-sub"><i class="fa-solid fa-cat"></i> Set up Chomusuke</h4>
            <div class="mtab-callout gold mgd-note"><i class="fa-solid fa-triangle-exclamation"></i><span>${CHOMUSUKE_SETUP_NOTE}</span></div>
            <ol class="mgd-steps">${CHOMUSUKE_SETUP_STEPS.map(s => `<li>${s}</li>`).join("")}</ol>
            <h4 class="mgd-sub">Good habits</h4>
            <ul class="mgd-practices">${PRACTICES.map(p => `<li>${p}</li>`).join("")}</ul>
        </div>
    `);

    let popup;
    const actions = {
        chomusuke: () => { popup.completeCancelled(); fireRefreshHook(REFRESH.SWITCH_TAB, "chomusuke"); }
    };

    const $models = $root.find(".mgd-models");
    MODELS.forEach(m => {
        const $card = $(`
            <div class="mgd-model">
                <div class="mgd-model-title"><i class="fa-solid ${m.icon}"></i> ${m.name}${m.models ? `<span>${m.models}</span>` : ""}</div>
                <ul>${m.tips.map(t => `<li>${t}</li>`).join("")}</ul>
            </div>
        `);
        if (m.action) {
            const $b = $(`<button type="button" class="menu_button mgd-action">${m.action.label} <i class="fa-solid fa-arrow-right"></i></button>`);
            $b.on("click", actions[m.action.id]);
            $card.append($b);
        }
        $models.append($card);
    });

    popup = new Popup($root, POPUP_TYPE.TEXT, "", { wide: true, allowVerticalScrolling: true, okButton: "Close" });
    // On the popup's frame, not inside its body: the body clips what overflows,
    // the frame doesn't, so she can sit over the bottom-right corner.
    popup.dlg.classList.add("mgd-popup");
    $(popup.dlg).append(`<img class="mgd-pic" src="${extensionFolderPath}/img/guide.png" alt="" />`);
    await popup.show();
}
