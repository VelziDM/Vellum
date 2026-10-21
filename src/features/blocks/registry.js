// ──────────────────────────────────────────────────────────────────────────────
// The <Blocks> envelope.
//
// The Blocks system itself is gone (the tab, the stack, the per-block presets),
// and the NPC Bank's system slots died with it (the bank was removed). What
// survives is the notebook's ask: the envelope's only remaining job is carrying
// it.
//
// The tag names in meguminAllBlockTags keep cleaning old chat text; the slot
// triggers ([[npc_dossier]] and friends) are stripped by data/slots.js.
// ──────────────────────────────────────────────────────────────────────────────

import { notebookBlockRequest } from "../../state/index.js";
import { NOTEBOOK_TAGS } from "../../state/modules/notebook/parse.js";

// Assembles the envelope: the notebook's ask when it is on. Returns "" when
// nothing is asked for, so the [[blocks]] tag is stripped from the preset
// rather than leaving an empty shell.
//
// The instruction is a literal skeleton rather than a description of one. Models
// follow a structure they can see far more reliably than a structure they have to
// infer from prose.
export function buildBlocksEnvelope() {
    let notebook = null;
    try { notebook = notebookBlockRequest(); } catch (e) { console.warn("[Megumin Suite] Notebook: could not build its request.", e); }
    if (!notebook) return "";

    // The rules come FIRST and the "output" line sits right above the skeleton.
    // Placed between the two, the rules read as part of what to write: the model
    // echoed them into its reply. They are headings, never tags, for the same reason.
    const rulesText = `These rules say how to fill the blocks below. Follow them; never write them out.\n\n${notebook.rules}\n\n`;
    const header = [
        "## At the end of your response, output exactly one <Blocks> section.",
        "Put every block inside it, in this order, each in its own tag. A block whose rules say to leave it out this turn is left out. Do not add tags that are not listed. Do not nest blocks inside each other. Close every tag you open. Never wrap a block in <details> or <summary>; write each block as its plain tag."
    ].join("\n");

    return `${rulesText}${header}\n\n<Blocks>\n${notebook.template}\n</Blocks>`;
}

// Every child tag the envelope (or the old block system) can produce. The
// cleaner strips each one, so a tag from an old reply is kept away from the
// summariser, the vault, image prompts and the ban list.
export function meguminAllBlockTags() {
    const dead = ["Dice", "World_State", "World_Update", "CYOA", "NPC_Inner_Chatter",
        "Bonds", "Character_Sheet", "Story_Tracker", "New_NPC", "NPC_Update"];
    // Story_Tracker is also stripped explicitly by the cleaner; the filter keeps
    // the list from building the same RegExp twice on every cleaned message.
    return [...new Set([
        ...NOTEBOOK_TAGS,
        ...dead
    ].filter(Boolean))];
}
