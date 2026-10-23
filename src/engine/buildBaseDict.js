// ─────────────────────────────────────────────────────────────────────────────
// Assembling the placeholder dictionary the preset is filled from.
//
// The top of the graph: it reads from every feature — the engine, story config,
// memory — and nothing reads from it except the injector and the token
// counter. That is why it moved last rather than first: extracting it early
// would have made it import from index.js instead of from the features.
//
// Two kinds of slot live here:
//
//   live      something fills it every turn (the engine's own text, the story
//             config, the memory blocks)
//   dead      nothing fills it any more, and it is written as "" so a preset
//             that still carries the tag rinses clean instead of leaking a
//             literal "[[whatever]]" into the model's context. The dead set is
//             the strip list in data/slots.js: a tag that is not in the
//             dictionary at all survives the fill pass untouched, so the two
//             lists are the same list.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings } from "../st.js";
import { extensionName } from "../core/constants.js";
import { localProfile } from "../core/state.js";
import { isCoWriterEngine } from "../core/engines.js";
import { DEFAULT_PROMPTS } from "../prompts/index.js";
import { hardcodedLogic } from "../../data/database.js";
import { memGetRelevantVaultEntries } from "../features/memory/index.js";
import { meguminAllSlotTriggers, meguminOverridableSlots, meguminSlotIsLive } from "../../data/slots.js";
import { resolveSlot } from "../core/sharedFragments.js";

export function buildBaseDict(isTokenCount = false) {
    const dict = {};
    if (!localProfile) return dict;

    const allAvailableModes = [...hardcodedLogic.modes, ...(extension_settings[extensionName].customModes || [])];
    const activeEngine = allAvailableModes.find(m => m.id === localProfile.mode);

    // Every trigger the injector knows, blanked before anything fills its own
    // slot. A hand-written list lived here and drifted: 23 strip-listed tags
    // were never blanked, and only the strip pass kept them from leaking.
    meguminAllSlotTriggers().forEach(t => { dict[t] = ""; });

    // 2. STANDARD STAGE SELECTIONS (Stage 2, 4, 5, 6)

    // The narrator voice (the Persona tab) is archived, and so are the two
    // protocol lines it owned. Their tags are on the strip list.

    // Stage 6 Defaults (CoT Framework & Language)
    const modData = hardcodedLogic.models.find(m => m.id === localProfile.model);
    if (localProfile.cotEnabled !== false && modData) {
        dict["[[COT]]"] = modData.content;
        if (modData.prefill) dict["[[prefill]]"] = modData.prefill;
    } else {
        dict["[[COT]]"] = "";
        dict["[[prefill]]"] = "";
    }

    // 3. ENGINE OVERRIDES (The "Superior" Layer)
    // This part runs last so it can overwrite standard Stage choices
    if (activeEngine) {
        // Map p1-p6.
        //
        // The bare-bracket twin [prompt1] is written too: an older preset
        // generation spells the tag that way, and the value is written even
        // when it is empty so an unused tag still gets blanked.
        for (let i = 1; i <= 6; i++) {
            const val = activeEngine[`p${i}`] || "";
            dict[`[[prompt${i}]]`] = val;
            dict[`[prompt${i}]`] = val;
        }

        // [[user]] -- the rule telling the model to keep its hands off {{user}}.
        //
        // Written here rather than by the add-on loop because it is not an add-on:
        // there is no switch for it, and the only engines it does not apply to
        // are the Co-writer ones, where authoring {{user}} is the whole point.
        // Sending it there would have one prompt argue with itself, so the slot
        // is blanked instead of skipped -- an unwritten tag would survive as a
        // literal "[[user]]" if the leak guard ever missed it.
        //
        // It sits immediately above the override pass so a shared fragment's
        // value still wins, exactly like every other shared slot.
        dict["[[user]]"] = isCoWriterEngine(activeEngine)
            ? ""
            : "The response does not speak, think, feel, or act for {{user}}, and it shows everything {{user}} reached for.";

        // Slot overrides, driven by MEGUMIN_SLOT_REGISTRY.
        //
        // Every placeholder declares itself once in data/slots.js, including the
        // condition that gates it, so the engine cannot disagree with the
        // registry about which slots exist or when they apply.
        //
        // Resolution is engine → shared → built-in (see core/sharedFragments).
        // "built-in" is deliberately NOT written back: the code above already
        // put the shipped default in the dictionary, and rewriting it here
        // would change nothing except add a second place for it to go wrong.
        meguminOverridableSlots().forEach(slot => {
            if (!meguminSlotIsLive(slot, localProfile)) return;
            const { value, source } = resolveSlot(slot, activeEngine);
            if (source === "builtin") return;
            dict[slot.trigger] = value;
        });
    }

// [[THINK]] macro.
    //
    // [[COT]] never travels under its own tag. The reasoning script is wrapped
    // in think tags and delivered inside [[THINK]], which is the tag the preset
    // actually carries; [[COT]] is then blanked so it is not sent twice.
    //
    // The wrapper is the Thinking Tags add-on and {Thinking} marks where the
    // script goes. This used to be two hardcoded template strings, which meant
    // an edited wrapper was silently discarded: the override pass runs far
    // above, and this line overwrote whatever it had put there.
    if (localProfile.cotEnabled !== false && dict["[[COT]]"]) {
        const defaultWrapper = "<?xml version=\"1.0\"?>\n<response>\n  <thinking>\n    {Thinking}\n  </thinking>\n  <output>\n    {Thinking}\n  </output>\n</response>";

        let wrapper = (dict["[[THINK]]"] && dict["[[THINK]]"].trim() !== "")
            ? dict["[[THINK]]"]
            : defaultWrapper;

        // A wrapper edited down to just the tags still has to receive the
        // script. Appending is better than dropping it on the floor, which
        // would look exactly like the CoT setting having no effect.
        if (!wrapper.includes("{Thinking}")) wrapper += "\n{Thinking}";

        dict["[[THINK]]"] = wrapper.split("{Thinking}").join(dict["[[COT]]"]);
        dict["[[COT]]"] = "";
    } else {
        dict["[[THINK]]"] = "";
}

    // Resolve early-evaluated tokens inside all other strings to prevent them from being missed and then cleaned up
    const earlyTokens = ["[[count]]", "[[DNRATIO]]", "[[img2]]"];
    earlyTokens.forEach(et => {
        if (dict[et] !== undefined) {
            const val = dict[et];
            Object.keys(dict).forEach(k => {
                if (k !== et && typeof dict[k] === 'string' && dict[k].includes(et)) {
                    dict[k] = dict[k].split(et).join(val);
                }
            });
        }
    });

    // --- 5. MEMORY CORE INJECTION ---
    // Initialize them as empty strings by default so the tags cleanly vanish if there are no memories
    dict["[[long-Memory]]"] = "";
    dict["[[Short-memory]]"] = "";

    if (localProfile.memoryCore && localProfile.memoryCore.enabled) {
        const mem = localProfile.memoryCore;

        const memCustom = mem.customPromptsEnabled ? mem.customPrompts : null;

        // A. Retrieve Long-Term Memories (Local TF-IDF Keyword Scoring)
        // updateLiveTokenCount drops [[long-Memory]] via excludeKeys anyway,
        // so the scan only ever fed a value that got thrown away
        if (!isTokenCount && mem.longTermVault && mem.longTermVault.length > 0) {
            const retrieved = memGetRelevantVaultEntries();
            if (retrieved.length > 0) {
                // Feed these to the model oldest-first so the archives read as a timeline instead of a relevance ranking.
                // Sort a COPY - the array can be the live semantic match list or the retrieval cache, never reorder it in place!
                const ordered = [...retrieved].sort((a, b) => {
                    const aStart = (a && typeof a.id === 'string') ? parseInt(a.id.split("-")[0], 10) : NaN;
                    const bStart = (b && typeof b.id === 'string') ? parseInt(b.id.split("-")[0], 10) : NaN;
                    return (Number.isFinite(aStart) ? aStart : 0) - (Number.isFinite(bStart) ? bStart : 0);
                });
                let longXML = "<retrieved_archives>\n";
                ordered.forEach(m => {
                    const dateStr = (m.timestamp || "").toLocaleString();
                    const content = m.text || m.summary || "";
                    longXML += `<archive_memory time="${dateStr}">\n[Msg ${m.id}]:\n${content}\n</archive_memory>\n`;
                });
                longXML += "</retrieved_archives>";

                const template = (memCustom && memCustom.longTermTemplate) || DEFAULT_PROMPTS.memoryCore.longTermTemplate;
                dict["[[long-Memory]]"] = template.replace('{{archiveXML}}', longXML);
            }
        }

        // B. Inject Short-Term Memories (Chronological)
        if (mem.shortTermChunks && mem.shortTermChunks.length > 0) {
            // Same rule as the long-term sort: imports can concatenate chunks out of order,
            // and one bad id must never break prompt assembly. Sort a COPY - this array IS
            // the stored data, reordering it here would rewrite storage on the next save.
            const orderedShort = [...mem.shortTermChunks].sort((a, b) => {
                const aStart = (a && typeof a.id === 'string') ? parseInt(a.id.split("-")[0], 10) : NaN;
                const bStart = (b && typeof b.id === 'string') ? parseInt(b.id.split("-")[0], 10) : NaN;
                return (Number.isFinite(aStart) ? aStart : 0) - (Number.isFinite(bStart) ? bStart : 0);
            });
            let shortXML = "<recent_state_extracts>\n";
            orderedShort.forEach(m => {
                const dateStr = (m.timestamp || "").toLocaleString();
                shortXML += `<archive_memory time="${dateStr}">[Msg ${m.id}]: ${m.summary}</archive_memory>\n`;
            });
            shortXML += "</recent_state_extracts>";

            const templateShort = (memCustom && memCustom.shortTermTemplate) || DEFAULT_PROMPTS.memoryCore.shortTermTemplate;
            dict["[[Short-memory]]"] = templateShort.replace('{{shortXML}}', shortXML);
        }
    }


    return dict;
}
