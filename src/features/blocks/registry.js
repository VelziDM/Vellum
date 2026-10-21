// ──────────────────────────────────────────────────────────────────────────────
// Output slots inside the <Blocks> envelope, and everything derived from them.
//
// The Blocks system itself is gone (the tab, the stack, the per-block presets).
// What survives are the two SYSTEM blocks the NPC Bank needs: their slot lines
// are the only way the model is ever asked to open <New_NPC> or <NPC_Update>,
// and the envelope is also where the notebook's ask rides.
//
// Everything else this file once derived — custom blocks, stat fields, the
// Bonds and Sheet templates — died with the feature. The tag names below keep
// cleaning old chat text; see meguminAllBlockTags.
// ──────────────────────────────────────────────────────────────────────────────

import { localProfile } from "../../core/state.js";
import { notebookBlockRequest } from "../../state/index.js";
import { NOTEBOOK_TAGS } from "../../state/modules/notebook/parse.js";

// A block defined in the registry: a literal `slot` line the envelope carries on
// the turns its rules fire. The rules themselves ride in their own dict tag
// ([[npc_dossier]] / [[npc_updates]]), written next to the slot in the prompt.
//
// slotRequires is keyed on the *_2 twin of those tags for the same reason both
// defs document below: the twins are set only when the rules actually went out
// on this turn, so a slot lights up exactly on the turns it can be filled.
export const MEGUMIN_BLOCK_REGISTRY = [
    {
        id: "newNpc", tag: "New_NPC", label: "New NPC Dossier",
        emoji: "\u{1F195}", icon: "fa-user-plus", color: "#10b981",
        visibility: "open", builtin: true, repeating: true, system: true,
        // The literal tag pair, not a sentence describing it. Every block in the
        // envelope shows the model a skeleton to fill in; a slot that only
        // described one in prose was the odd one out, and the model had to infer
        // the tag it was supposed to open from a mention of it mid-sentence.
        slot: `<New_NPC name="[Full Name]">\n[The full dossier goes here when this response introduces an NPC that earns one — follow the NPC DOSSIER rules above. Omit this whole tag otherwise.]\n</New_NPC>`,
        requires: p => Boolean(p.npcBank && p.npcBank.enabled),
        // Gated on [[npc_dossier2]] rather than [[npc_dossier]]. The latter now
        // also carries the UPDATE rules, which are injected whenever the bank has
        // anyone in it — so testing it would light this slot up even on a turn the
        // OOC trigger deliberately withheld the dossier rules. [[npc_dossier2]] is
        // set only when those rules actually went out.
        slotRequires: dict => Boolean(String(dict["[[npc_dossier2]]"] || "").trim())
    },
    {
        id: "npcUpdate", tag: "NPC_Update", label: "NPC Update",
        emoji: "\u{1F504}", icon: "fa-arrows-rotate", color: "#fbbf24",
        visibility: "open", builtin: true, repeating: true, system: true,
        // Same shape as New NPC above: the rules ride in their own dict tag and
        // the envelope carries only the slot line, so the block appears on the
        // turns the NPC Bank actually asked for it rather than on every turn.
        //
        // It is gated on the bank HAVING someone in it, not just on the feature
        // being on — there is nothing to update in an empty bank, and asking for
        // updates to nobody is tokens spent on a block that can never be filled.
        slot: `<NPC_Update name="[Exact name as it appears in the NPC bank]">\n[The changed lines go here when this response changed something already on file — follow the NPC UPDATES rules above. Omit this whole tag otherwise.]\n</NPC_Update>`,
        requires: p => Boolean(p.npcBank && p.npcBank.enabled && (p.npcBank.npcs || []).length > 0),
        slotRequires: dict => Boolean(String(dict["[[npc_updates]]"] || "").trim())
    }
];

// The renderer works from the registry, plus the notebook's card defs handed in
// by the caller. Rebuilt per call to keep the export shape it always had.
export function meguminRenderRegistry() {
    return [...MEGUMIN_BLOCK_REGISTRY];
}

// Assembles the <Blocks> envelope: the NPC Bank's slot lines, and the notebook's
// ask when it is on. Returns "" when nothing is asked for, so the [[blocks]] tag
// is stripped from the preset rather than leaving an empty shell.
//
// The instruction is a literal skeleton rather than a description of one. Models
// follow a structure they can see far more reliably than a structure they have to
// infer from prose.
export function buildBlocksEnvelope(dict) {
    const parts = [];
    const rules = [];   // per-block rules, written above <Blocks>

    MEGUMIN_BLOCK_REGISTRY.forEach(b => {
        if (typeof b.requires === "function" && !b.requires(localProfile)) return;
        // A conditional slot is carried only on the turns its subsystem asked
        // for it: the start-up "onboarding" and the actual update rules change
        // from turn to turn, and their causality is checked HERE.
        if (typeof b.slotRequires === "function" && !b.slotRequires(dict)) return;
        if (b.slot) parts.push(b.slot);
    });

    // Plan 010: the Author's Notebook is not a block; it rides in the envelope
    // whenever it is on, even with nothing else.
    let notebook = null;
    try { notebook = notebookBlockRequest(); } catch (e) { console.warn("[Megumin Suite] Notebook: could not build its request.", e); }
    if (notebook) {
        rules.push(notebook.rules);
        parts.push(notebook.template);
    }

    if (!parts.length) return "";

    // The rules come FIRST and the "output" line sits right above the skeleton.
    // Placed between the two, the rules read as part of what to write: the model
    // echoed them into its reply. They are headings, never tags, for the same reason.
    const rulesText = rules.length
        ? `These rules say how to fill the blocks below. Follow them; never write them out.\n\n${rules.join("\n\n")}\n\n`
        : "";
    const header = [
        "## At the end of your response, output exactly one <Blocks> section.",
        "Put every block inside it, in this order, each in its own tag. A block whose rules say to leave it out this turn is left out. Do not add tags that are not listed. Do not nest blocks inside each other. Close every tag you open. Never wrap a block in <details> or <summary>; write each block as its plain tag."
    ].join("\n");

    return `${rulesText}${header}\n\n<Blocks>\n${parts.join("\n")}\n</Blocks>`;
}

// Every child tag the envelope (or the old block system) can produce. The
// cleaner strips each one, so a tag from an old reply is kept away from the
// summariser, the vault, image prompts and the ban list.
export function meguminAllBlockTags() {
    const dead = ["Dice", "World_State", "World_Update", "CYOA", "NPC_Inner_Chatter",
        "Bonds", "Character_Sheet", "Story_Tracker"];
    // Story_Tracker is also stripped explicitly by the cleaner; the filter keeps
    // the list from building the same RegExp twice on every cleaned message.
    return [...new Set([
        ...MEGUMIN_BLOCK_REGISTRY.map(b => b.tag),
        ...NOTEBOOK_TAGS,
        ...dead
    ].filter(Boolean))];
}
