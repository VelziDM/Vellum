// ─────────────────────────────────────────────────────────────────────────────
// MEGUMIN_SLOT_REGISTRY — every [[placeholder]] the engine knows about.
//
// This is the same idea as MEGUMIN_BLOCK_REGISTRY, applied to the other half of
// the system. A placeholder used to be declared in three hand-maintained lists:
//
//   1. an editor box in the Dev Mode UI                       (the editor box)
//   2. an entry in the overrides[] array in buildBaseDict.js  (the actual wiring)
//   3. a string in the 60-tag cleanup array in injection.js   (the leak guard)
//
// Only #2 was load-bearing, so forgetting #1 meant an uneditable slot and
// forgetting #3 meant a raw "[[whatever]]" leaking into the model's context.
// Three edits, three chances to miss one, and two of the three failures are
// silent. Everything is now derived from the one entry below.
//
// Adding a placeholder means adding ONE object here. If you find yourself
// editing the cleanup list to introduce a slot, stop — the thing you are about
// to hand-write is meant to be derived.
// ─────────────────────────────────────────────────────────────────────────────

import { models, modes } from "./database.js";
import { isCoWriterEngine } from "../src/core/engines.js";

// ── Scopes ───────────────────────────────────────────────────────────────────
//
// engine  this engine's own text. Lives on the engine object. Editing it means
//         cloning, exactly as it always has.
// shared  one value for the whole install, stored outside every engine in
//         extension_settings[...].sharedFragments. No engine CONTAINS this
//         text — they all leave the slot for the dictionary to fill — which is
//         why one edit reaches stock V7 and your own clone alike.
// auto    built at generation time by a feature. Read-only unless the slot is
//         marked overridable, in which case it can be shadowed by a value.
//
export const SLOT_SCOPE = { ENGINE: "engine", SHARED: "shared", AUTO: "auto" };

// ── Gates ────────────────────────────────────────────────────────────────────
//
// What has to be switched on for a slot to reach the prompt at all. These
// MIRROR the conditions in buildBaseDict's overrides[] array — that is the
// point of recording them: the editor can now say "this is currently off and
// your text will not be used", instead of silently accepting an edit that goes
// nowhere. `where` names the tab the reader has to visit to switch it on.
//
const gate = (test, label, where) => ({ test, label, where });

const GATE = {
    think:   gate(p => p.cotEnabled !== false, "Chain of Thought", "Preset & Thinking"),
    dnratio: gate(p => !!(p.dnRatio && p.dnRatio.enabled), "Dialogue/Narration ratio", "Writing Style"),

    // The one gate keyed on the ENGINE rather than a switch the reader flips.
    // Every engine gets the "never write for {{user}}" rule except the Co-writer
    // variants, where authoring {{user}} is the whole point -- sending it there
    // would have the engine contradict itself inside one prompt.
    //
    // Custom clones are resolved from customModes as well as the shipped list,
    // because a clone of a Co-writer is still a Co-writer.
    notCoWriter: gate(p => !isCoWriterEngine(meguminModeById(p && p.mode)),
                      "a non Co-writer engine", "Preset & Thinking"),
};

/**
 * Look up an engine by id across the shipped list and the reader's own clones.
 *
 * Gates receive the profile, not the engine, so a gate that depends on which
 * engine is selected has to resolve it. extension_settings is read lazily off
 * globalThis rather than imported: data/ sits below src/ in the layering and
 * must not pull in core/state, and a missing store simply means "no clones".
 */
function meguminModeById(id) {
    if (!id) return null;
    const found = modes.find(m => m.id === id);
    if (found) return found;
    try {
        const store = globalThis.extension_settings || {};
        const bucket = store["Megumin-Suite"] || store["Megumin-Suite-Beta"] || {};
        return (bucket.customModes || []).find(m => m.id === id) || null;
    } catch { return null; }
}


// The chain-of-thought library, offered as a dropdown on the two slots that can
// be filled from it. cot-off is skipped: it exists to mean "no reasoning", and
// picking it would silently empty the box rather than load anything.
const cotPicker = key => () => models
    .filter(m => m.id !== "cot-off" && (m[key] || "").trim() !== "")
    .map(m => ({ label: m.id, value: m[key] }));

export const MEGUMIN_SLOT_REGISTRY = [
    // ── The engine's own voice ───────────────────────────────────────────────
    { key: "p1", trigger: "[[prompt1]]", structural: true, label: "Prompt 1", scope: "engine", group: "engine",
      hint: "The first thing the model reads. Sets the ground rules." },
    { key: "p2", trigger: "[[prompt2]]", structural: true, hidden: true, label: "Prompt 2", scope: "engine", group: "engine",
      hint: "Runs straight on from the opening rules." },
    { key: "p3", trigger: "[[prompt3]]", structural: true, label: "Prompt 3", scope: "engine", group: "engine",
      hint: "Closes the first system message." },
    { key: "p4", trigger: "[[prompt4]]", structural: true, label: "Prompt 4", scope: "engine", group: "engine",
      hint: "How the model is meant to write. Usually the longest section." },
    { key: "p5", trigger: "[[prompt5]]", structural: true, label: "Prompt 5", scope: "engine", group: "engine",
      hint: "How characters act and what the model may decide on its own." },
    { key: "p6", trigger: "[[prompt6]]", structural: true, label: "Prompt 6", scope: "engine", group: "engine",
      hint: "The last of the engine's own instructions." },
    { key: "A1", trigger: "[[AI1]]", structural: true, hidden: true, label: "Model Acknowledgement 1", scope: "engine", group: "engine",
      advanced: true, hint: "A fake reply from the model, agreeing that it read the rules." },
    { key: "A2", trigger: "[[AI2]]", structural: true, hidden: true, label: "Model Acknowledgement 2", scope: "engine", group: "engine",
      advanced: true, hint: "The second fake acknowledgement." },

    // ── Reasoning ────────────────────────────────────────────────────────────
    { key: "cot", trigger: "[[COT]]", label: "Chain of Thought", scope: "engine", group: "reasoning",
      carrier: "think",
      picker: { label: "Load from a chain-of-thought", options: cotPicker("content") },
      hint: "The reasoning script the model works through before it writes. Engine-specific, because it is written to match the engine's own rules." },
    { key: "prefill", trigger: "[[prefill]]", label: "Prefill", scope: "engine", group: "reasoning",
      picker: { label: "Load from a chain-of-thought", options: cotPicker("prefill") },
      hint: "Words put into the model's mouth to start its reply." },
    { key: "think", trigger: "[[THINK]]", label: "Thinking Tags", scope: "shared", group: "reasoning",
      gate: GATE.think,
      hint: "The tags the reasoning is wrapped in. {Thinking} marks where the engine's Chain of Thought is dropped in — keep it, or the script has nowhere to go.",
      fallback: () => "<think>\n<think>\n<think>\n{Thinking}\n</think>" },

    // ── Shared fragments: one value, every engine ────────────────────────────
    { key: "userControl", trigger: "[[user]]", label: "Never Write For {{user}}", scope: "shared", group: "systems",
      gate: GATE.notCoWriter,
      hint: "Sent on every engine except the Co-writer variants, which are built to write {{user}}. It lands in the preset's numbered final reminder list, so keep it written as a numbered line.",
      fallback: () => "5. The response does not speak, think, feel, or act for {{user}}, and it shows everything {{user}} reached for." },
    { key: "dnratio", trigger: "[[DNRATIO]]", label: "Dialogue / Narration Ratio", scope: "shared", group: "format",
      gate: GATE.dnratio, hint: "How much of a reply should be speech versus description.",
      fallback: () => "Ratio: Maintain a balance of 50% Dialogue and 50% Narration." },

    // ── Computed from your settings. Overridable, but rarely worth it ────────
    { key: "count", trigger: "[[count]]", label: "Word Count", scope: "auto", group: "global",
      overridable: true, deprecated: true, where: "Preset & Thinking",
      hint: "Superseded by Length in Story Config. Always sent empty unless you override it here." },

    // ── Filled live by a feature. Nothing to edit ────────────────────────────
    { key: null, trigger: "[[config]]", label: "Story Config", scope: "auto", group: "live", where: "Preset & Thinking",
      hint: "The <config> block built from your Story Config choices." },
    { key: null, trigger: "[[long-Memory]]", label: "Long-term Memory", scope: "auto", group: "live", where: "Memory",
      hint: "Archived summaries pulled from the vault for this turn." },
    { key: null, trigger: "[[Short-memory]]", label: "Short-term Memory", scope: "auto", group: "live", where: "Memory",
      hint: "Recent chat kept verbatim." },
    { key: null, trigger: "[[img1]]", label: "Image Rules", scope: "auto", group: "live", where: "Images",
      hint: "Instructions for emitting image prompts." },
    { key: null, trigger: "[[aiprompt]]", label: "Narration Style", scope: "auto", group: "live",
      where: "Writing Style",
      hint: "Your writing style, wrapped differently depending on the engine generation." },
];

// ── Derived views. Never hand-maintain these ────────────────────────────────

/**
 * Every trigger the injector must strip if nothing filled it. Replaces the
 * 60-string array that used to sit inline in injection.js.
 */
export function meguminAllSlotTriggers() {
    const out = new Set();
    MEGUMIN_SLOT_REGISTRY.forEach(s => out.add(s.trigger));
    // Numbered twins: some presets emit a block a second time further down.
    ["[[infoblock2]]", "[[cyoa2]]", "[[storytracker2]]", "[[npc_inner_chatter2]]",
        "[[img2]]", "[[dice_rolls]]", "[[order]]",
        "[[v9_lean_min]]", "[[v9_lean_max]]", "[[v9_full_min]]", "[[v9_full_max]]"]
        .forEach(t => out.add(t));
    // Triggers of add-on slots that were removed with the Language & Add-ons
    // tab. Nothing fills these any more, so old presets carrying the tags
    // would leak them verbatim into the prompt — the strip pass keeps them
    // from ever reaching the model.
    ["[[death]]", "[[combat]]", "[[html]]", "[[dice]]", "[[Direct]]", "[[DN]]", "[[COLOR]]",
        "[[onomato]]", "[[Language]]", "[[pronouns]]", "[[npc_events]]", "[[MVU]]",
        // The blocks system is gone (its slot lines above); old presets still
        // carrying these tags would leak them otherwise. [[infoblockcorrent]]
        // is an old misspelling of [[infoblockcurrent]] some presets carry.
        "[[infoblock]]", "[[cyoa]]", "[[npc_inner_chatter]]", "[[storytracker]]",
        "[[blocks]]", "[[notebook]]", "[[infoblockcurrent]]", "[[infoblockcorrent]]", "[[banlist]]",
        // The Persona tab is archived: the narrator voice and the two protocol
        // lines it owned.
        "[[main]]", "[[OOC]]", "[[control]]",
        // The NPC Bank is gone too (its slot lines above were its only writers).
        "[[npc_dossier]]", "[[npc_dossier2]]", "[[npc_updates]]", "[[npc list]]"]
        .forEach(t => out.add(t));
    // The bare-bracket spellings an older preset generation used.
    for (let i = 1; i <= 6; i++) out.add(`[prompt${i}]`);
    return [...out];
}

/**
 * The slots buildBaseDict's override pass may take from an engine or from the
 * shared bucket.
 *
 * Structural slots are excluded. p1..p6 and AI1/AI2 are written a few lines
 * earlier by hand, and that code does more than a plain assignment: the p1..p6
 * loop also fills the bare-bracket twin [prompt1] that older presets use, and
 * it writes even when the value is empty so an unused tag still gets blanked.
 * Running them through here as well would be a redundant second write, which is
 * exactly the kind of "two places set the same thing" this registry exists to
 * remove.
 */
export function meguminOverridableSlots() {
    return MEGUMIN_SLOT_REGISTRY.filter(s =>
        s.key && !s.structural && (s.scope !== "auto" || s.overridable));
}

export function meguminSlotByTrigger(trigger) {
    return MEGUMIN_SLOT_REGISTRY.find(s => s.trigger === trigger) || null;
}

export function meguminSlotByKey(key) {
    return MEGUMIN_SLOT_REGISTRY.find(s => s.key === key) || null;
}

/**
 * Is this slot's toggle currently on? Slots with no gate are always live.
 * A throwing gate reports live: a broken predicate must not make the editor
 * claim a slot is dead when the engine would happily use it.
 */
export function meguminSlotIsLive(slot, profile) {
    if (!slot || !slot.gate || !profile) return true;
    try { return !!slot.gate.test(profile); } catch { return true; }
}

/**
 * Which slot a custom module hangs off.
 *
 * Modules used to be nailed to p3, p5 and p6, because those were the only
 * positions the old editor drew an insert point at. They can now attach to any
 * slot, so the stored value is a full trigger. Older engines stored "p3", and
 * they keep working: anything that is not already bracketed is read as the old
 * spelling. buildBaseDict and the editor both come here rather than each
 * rebuilding the string, which is how the two used to drift.
 */
export function meguminModuleTrigger(attachPoint) {
    if (!attachPoint) return null;
    if (attachPoint.startsWith("[[")) return attachPoint;
    const n = String(attachPoint).replace(/^p/, "");
    return `[[prompt${n}]]`;
}

export const SLOT_GROUPS = [
    { id: "engine", label: "The Engine's Own Rules", hint: "Belongs to this engine. Editing means saving your own copy." },
    { id: "reasoning", label: "Reasoning" },
    { id: "systems", label: "Systems" },
    { id: "format", label: "Formatting" },
    { id: "global", label: "Built From Your Settings" },
    { id: "live", label: "Filled In Automatically" },
];
