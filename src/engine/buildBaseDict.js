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
//             literal "[[whatever]]" into the model's context. Every dead tag
//             is also on the strip list in data/slots.js, because a tag that is
//             not in the dictionary at all survives the fill pass untouched.
// ─────────────────────────────────────────────────────────────────────────────

import { extension_settings } from "../st.js";
import { extensionName } from "../core/constants.js";
import { localProfile } from "../core/state.js";
import { isCoWriterEngine } from "../core/engines.js";
import { DEFAULT_PROMPTS } from "../prompts/index.js";
import { hardcodedLogic } from "../../data/database.js";
import { buildConfigBlock } from "../features/storyconfig/config.js";
import { memGetRelevantVaultEntries } from "../features/memory/index.js";
import { meguminOverridableSlots, meguminSlotIsLive } from "../../data/slots.js";
import { resolveSlot } from "../core/sharedFragments.js";

export function buildBaseDict(isTokenCount = false) {
    const dict = {};
    if (!localProfile) return dict;

    const allAvailableModes = [...hardcodedLogic.modes, ...(extension_settings[extensionName].customModes || [])];
    const activeEngine = allAvailableModes.find(m => m.id === localProfile.mode);

    // Tags of features that are gone. Blank, never dropped: see the header.
    const dead = [
        "[[count]]", "[[DNRATIO]]", "[[img1]]", "[[img2]]",
        "[[main]]", "[[OOC]]", "[[control]]", "[[AI1]]", "[[AI2]]",
        "[[storyplan]]", "[[storytracker]]",
        "[[v9_lean_min]]", "[[v9_lean_max]]", "[[v9_full_min]]", "[[v9_full_max]]"
    ];
    dead.forEach(t => { dict[t] = ""; });

    // Story Config (<config> block). Empty when the config is off or every field is on Default.
    dict["[[config]]"] = buildConfigBlock(localProfile.storyConfig);

    // 2. STANDARD STAGE SELECTIONS (Stage 2, 4, 5, 6)

    // The narrator voice (the Persona tab) is archived, and so are the two
    // protocol lines it owned. Their tags are in the dead list above.
    //
    // POV moved out of the style library and into the Story Config block.
    const povInjectionStr = "";

    // The writing style. It is the reader's own voice, sent as it is.
    if (localProfile.aiRule) {
        dict["[[aiprompt]]"] = povInjectionStr + localProfile.aiRule;
    }

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
            : "5. The response does not speak, think, feel, or act for {{user}}, and it shows everything {{user}} reached for.";

        // The writing style, when the engine's own text carries the anchor.
        //
        // An engine may write the style into its own prose ("JULIA is:
        // [[aiprompt]]"). When it does, the style goes there and the
        // [[aiprompt]] slot itself is emptied, so the style is sent once and
        // not twice. When the engine does not carry the anchor, the slot keeps
        // the style and the preset's own place for it does the work.
        const styleText = dict["[[aiprompt]]"] || "";
        if (styleText) {
            let carried = false;
            for (let i = 1; i <= 6; i++) {
                const key = `[[prompt${i}]]`;
                if (dict[key] && dict[key].includes("[[aiprompt]]")) {
                    dict[key] = dict[key].split("[[aiprompt]]").join(styleText);
                    carried = true;
                }
            }
            if (carried) dict["[[aiprompt]]"] = "";
        }

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

    // NEW: Inject Thinking Effort to the absolute top of whatever [[COT]] is currently active
    // Not for a Thinking Cap: it sets its own length, and a word count makes the
    // models it is for count and redraft.
    let effort = localProfile.thinkEffort || "unspecified";
    const isCap = /^cot-.+-cap-/.test(localProfile.model || "");
    if (effort !== "unspecified" && dict["[[COT]]"] && !isCap) {
        let words = effort === "custom" ? (localProfile.customThinkEffort || "100") : effort;
        dict["[[COT]]"] = `Your Thinking must not be more than ${words} words.\n\n` + dict["[[COT]]"];
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
        const defaultWrapper = localProfile.thinkingV2
            ? "<think>\n<think>\n<think>\n{Thinking}\n</think>"
            : "<think>\n{Thinking}\n</think>";

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

    if (localProfile.thinkingV2 && dict["[[prefill]]"]) {
        dict["[[prefill]]"] = dict["[[prefill]]"].replace(/\n<think>[\s\S]*/, "\n<think>\n<think>");
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
