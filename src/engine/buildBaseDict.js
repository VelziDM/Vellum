// ────────────────────────────────────────────────────────────────────────────
// Assembling the placeholder dictionary the preset is filled from.
//
// The top of the graph: it reads from every feature — story
// config, memory — and nothing reads from it except the injector and the
// token counter. That is why it moved last rather than first: extracting it
// early would have made it import from index.js instead of from the features.
// ────────────────────────────────────────────────────────────────────────────

import { getContext, extension_settings, substituteParams } from "../st.js";
import { extensionName } from "../core/constants.js";
import { localProfile } from "../core/state.js";
import { isV7Engine, isV8Engine, isModernEngine, engineUsesRenderLimits, isCoWriterEngine } from "../core/engines.js";
import { DEFAULT_PROMPTS } from "../prompts/index.js";
import { hardcodedLogic } from "../../data/database.js";
import { applyEnhancedDialogue } from "../../data/modes/v10.js";
import { buildConfigBlock } from "../features/storyconfig/config.js";
import { memGetRelevantVaultEntries } from "../features/memory/index.js";
import { meguminOverridableSlots, meguminSlotIsLive, meguminModuleTrigger } from "../../data/slots.js";
import { resolveSlot } from "../core/sharedFragments.js";

export function buildBaseDict(isTokenCount = false) {
    const dict = {};
    if (!localProfile) return dict;

    const allAvailableModes = [...hardcodedLogic.modes, ...(extension_settings[extensionName].customModes || [])];
    const activeEngine = allAvailableModes.find(m => m.id === localProfile.mode);
    const isV7 = isV7Engine(activeEngine);
    const isV8 = isV8Engine(activeEngine);
    // Everything V8/V9 does, V10 does too. The one exception is the Lean/Full render
    // split below, which asks engineUsesRenderLimits() instead.
    const isModern = isModernEngine(activeEngine);

    if (engineUsesRenderLimits(activeEngine)) {
        // Fixed window sizes. The editable limits died with the Language &
        // Add-ons tab; the engine text still carries the tags, so the numbers
        // ship as constants now.
        dict["[[v9_lean_min]]"] = "300";
        dict["[[v9_lean_max]]"] = "400";
        dict["[[v9_full_min]]"] = "700";
        dict["[[v9_full_max]]"] = "1200";

        // Strip normal count entirely just in case
        dict["[[count]]"] = "";
    } else {
        dict["[[v9_lean_min]]"] = "";
        dict["[[v9_lean_max]]"] = "";
        dict["[[v9_full_min]]"] = "";
        dict["[[v9_full_max]]"] = "";
    }

    // The legacy word count is gone — length now lives in the Story Config block.
    // The tag is still emitted as empty so any preset that still carries it gets it stripped.
    dict["[[count]]"] = "";

    // Story Config (<config> block). Empty when the config is off or every field is on Default.
    dict["[[config]]"] = buildConfigBlock(localProfile.storyConfig);

    // 2. STANDARD STAGE SELECTIONS (Stage 2, 4, 5, 6)

    // Personality (Stage 2) - Will be overwritten later if Custom Engine is active
    const pData = hardcodedLogic.personalities.find(p => p.id === localProfile.personality);
    dict["[[main]]"] = pData ? pData.content : "";
    dict["[[AI1]]"] = "Understood."; // Default
    dict["[[AI2]]"] = "Understood."; // Default

    if (localProfile.personality === "megumin") {
        dict["[[AI1]]"] = "Fine i read the rules.";
        dict["[[AI2]]"] = "OK i Understnd it.";
    }

    // Standard Toggles
    if (localProfile.toggles.ooc) dict["[[OOC]]"] = hardcodedLogic.toggles.ooc.content;
    if (localProfile.toggles.control) dict["[[control]]"] = hardcodedLogic.toggles.control.content;
    // POV moved out of the style library and into the Story Config block.
    const povInjectionStr = "";

    if (localProfile.mode === "v7.5") {
        let narratorPersona = localProfile.aiRule ? localProfile.aiRule : "Adopt the narration of an unseen, witty observer who is vividly present in the scene. The narrator has a distinct personality—dry, occasionally judgmental, quietly amused, or sharply critical. Feel free to throw subtle shade at terrible decisions, point out the absurdity of a situation, or comment on the scene's chaos with a bit of comedic flair.";
        
        dict["[[aiprompt]]"] = `<Narration_style>\n narrator_persona: "${povInjectionStr}${narratorPersona}"\n quarantine_rule: "CRITICAL: This opinionated voice applies STRICTLY and EXCLUSIVELY to the narration. It MUST NOT bleed into <NPC_dialogue>. NPCs do not share the narrator's wit or perspective; their dialogue remains entirely bound by their own demographics, stress levels, and individual flaws."\n proportional_prose: "Match narrative intensity to the event. A spilled coffee is just a minor annoyance, not a catalyst for dramatic prose. Zero purple prose. Use grounded metaphors sparingly to anchor a scene, not distract from it."\n</Narration_style>`;
    } else if (localProfile.aiRule) {
        if (isV7 && localProfile.activeStyleId !== "dir_v7" && localProfile.activeStyleId !== "dir_v7_core" && localProfile.activeStyleId !== "dir_v7_gentle") {
            dict["[[aiprompt]]"] = `<narrative_style>\n voice: ${povInjectionStr}${localProfile.aiRule}\n  pacing: "Unhurried where it should be. A quiet moment can take a paragraph. A violent one can take a sentence. Match the rhythm to the content."\n  length_directive: "Typical outputs should run 3–6 substantial paragraphs, scaling with scene density. Lean toward the higher end during rich, atmospheric, or multi-character scenes. Go shorter — even a single paragraph — only when the moment genuinely demands economy: a held breath, a door closing, a line that hits harder alone. Never pad, never rush."\n</narrative_style>`;
        } else {
            dict["[[aiprompt]]"] = povInjectionStr + localProfile.aiRule;
        }
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

    if (localProfile.dnRatio && localProfile.dnRatio.enabled) {
        const d = localProfile.dnRatio.dialogue;
        const n = 100 - d;
        dict["[[DNRATIO]]"] = `- Ratio: Maintain a balance of ${d}% Dialogue and ${n}% Narration.`;
    } else {
        dict["[[DNRATIO]]"] = "";
    }

    // 3. ENGINE OVERRIDES (The "Superior" Layer)
    // This part runs last so it can overwrite standard Stage choices
    const isCustom = activeEngine && !hardcodedLogic.modes.find(x => x.id === activeEngine.id);

    if (activeEngine) {
        // Map p1-p6
        //
        // Enhanced Dialogue is applied here rather than at the engine definition,
        // because this is the one place the engine's prompt text is read — the
        // token counter comes through the same function, so the count and the
        // prompt can never disagree about which dialogue section is in play.
        //
        // The swap is keyed on the engine's own id, so a clone gets its own
        // setting rather than inheriting the original's, and it is a no-op on any
        // engine whose prompts carry no <dialogue> tag.
        const enhanced = Boolean(localProfile.enhancedDialogue
            && localProfile.enhancedDialogue[activeEngine.id]);
        for (let i = 1; i <= 6; i++) {
            let val = activeEngine[`p${i}`] || "";
            if (enhanced) val = applyEnhancedDialogue(val);
            dict[`[[prompt${i}]]`] = val;
            dict[`[prompt${i}]`] = val;
        }

        // Custom Engines kill [[main]] personality ONLY if they are truly built from scratch
        if (isCustom && activeEngine.isCoreClone !== true) {
            dict["[[main]]"] = "";
        }

        // Engine-specific AI Prefills (If defined in the engine)
        if (activeEngine.A1) dict["[[AI1]]"] = activeEngine.A1;
        if (activeEngine.A2) dict["[[AI2]]"] = activeEngine.A2;

        // [[user]] -- the rule telling the model to keep its hands off {{user}}.
        //
        // Written here rather than by the add-on loop because it is not an add-on:
        // there is no switch for it, it applies to every engine except the
        // Co-writer variants, and those are precisely the engines built to write
        // {{user}}. Sending it to a Co-writer would have one prompt argue with
        // itself, so the slot is blanked instead of skipped -- an unwritten tag
        // would survive as a literal "[[user]]" if the leak guard ever missed it.
        //
        // It sits immediately above the override pass so a Dev Mode edit of the
        // shared fragment still wins, exactly like every other shared slot.
        dict["[[user]]"] = isCoWriterEngine(activeEngine)
            ? ""
            : "5. The response does not speak, think, feel, or act for {{user}}, and it shows everything {{user}} reached for.";

        // Slot overrides, driven by MEGUMIN_SLOT_REGISTRY.
        //
        // This used to be a hand-written overrides[] array duplicating the list
        // of editor boxes in devmode.js. Every placeholder now declares itself
        // once in data/slots.js, including the condition that gates it, so the
        // editor and the engine cannot disagree about which slots exist or when
        // they apply.
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


        // Custom Toggles Appender
        //
        // The target used to be rebuilt here as "[[prompt" + n + "]]", which is
        // why modules could only ever attach to p3/p5/p6. meguminModuleTrigger
        // owns that spelling now and accepts a full trigger, so a module can
        // hang off any slot in the document while old engines storing "p3"
        // keep resolving exactly as before.
        if (activeEngine.customToggles) {
            activeEngine.customToggles.forEach(ct => {
                if (!localProfile.toggles[ct.id]) return;
                const targetKey = meguminModuleTrigger(ct.attachPoint);
                if (targetKey && dict[targetKey] !== undefined) {
                    dict[targetKey] += `\n\n${ct.content}`;
                }
            });
        }

        // V7 Dynamic Stripping
        if (isV7) {
            if (!localProfile.toggles.v7_ooc && dict["[[prompt1]]"]) {
                dict["[[prompt1]]"] = dict["[[prompt1]]"].replace(/<ooc_protocol>[\s\S]*?<\/ooc_protocol>/g, "");
            }
            if (dict["[[prompt4]]"]) {
                if (!localProfile.toggles.v7_pcsolo) {
                    dict["[[prompt4]]"] = dict["[[prompt4]]"].replace(/<pc_solo_physicality[\s\S]*?<\/pc_solo_physicality>/g, "");
                }
                if (!localProfile.toggles.v7_culture) {
                    dict["[[prompt4]]"] = dict["[[prompt4]]"].replace(/<cultural_anchoring>[\s\S]*?<\/cultural_anchoring>/g, "");
                }
                if (!localProfile.toggles.v7_scene) {
                    dict["[[prompt4]]"] = dict["[[prompt4]]"].replace(/<scene_choreography>[\s\S]*?<\/scene_choreography>/g, "");
                }
                if (!localProfile.toggles.v7_intro) {
                    dict["[[prompt4]]"] = dict["[[prompt4]]"].replace(/\s*introduction_protocol:\s*"[^"]*"/g, "");
                }
            }
        }
        // V8/V9 Dynamic Injection & Stripping
        if (isModern) {
            // 1. Inject [[aiprompt]] directly into the engine prompts (like p6) where the tag exists
            const aiPromptVal = dict["[[aiprompt]]"] || "";
            for (let i = 1; i <= 6; i++) {
                if (dict[`[[prompt${i}]]`] && dict[`[[prompt${i}]]`].includes("[[aiprompt]]")) {
                    dict[`[[prompt${i}]]`] = dict[`[[prompt${i}]]`].split("[[aiprompt]]").join(aiPromptVal);
                }
            }
            // 2. Wipe [[aiprompt]] from the dictionary so it gets erased from the main ST Preset!
            dict["[[aiprompt]]"] = "";
        }
    }

    // Wipe main persona for V6, V7, V8, and V9
    if (localProfile.mode.includes("v6-dream-team") || isV7 || isModern) {
        dict["[[main]]"] = "";
    }

    // Wipe Persona & Toggle tags entirely for V8, V9 and V10
    if (isModern) {
        dict["[[OOC]]"] = "";
        dict["[[control]]"] = "";
        dict["[[AI1]]"] = "";
        dict["[[AI2]]"] = "";
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
    // above, and this line overwrote whatever it had put there. The add-on
    // could be edited and saved and never did anything.
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

    // [[storyplan]] / [[storytracker]] — the Story Director is gone. Blank both
    // unconditionally so presets still carrying the tags rinse clean instead of
    // leaking literals into the model's context.
    dict["[[storyplan]]"] = "";
    dict["[[storytracker]]"] = "";

    // 4. FINAL INJECTIONS (Banlist)
    // ponytail: image generation is cut out of this build. The anchors stay
    // blank rather than removed so old presets carrying the tags keep rinsing
    // clean instead of leaking a literal [[img1]] into the model's context.
    if (localProfile.banList && localProfile.banList.length > 0) {
        const banStr = localProfile.banList.map(b => `- ${b}`).join("\n");
        const banCustom = localProfile.banListCustomPromptsEnabled ? localProfile.banListCustomPrompts : null;
        const template = (banCustom && banCustom.injectionTemplate) || DEFAULT_PROMPTS.banList.injectionTemplate;
        dict["[[banlist]]"] = template.replace('{{banItems}}', banStr);
    } else {
        dict["[[banlist]]"] = "";
    }

    dict["[[img1]]"] = "";
    dict["[[img2]]"] = "";

    if (localProfile.thinkingV2 && dict["[[prefill]]"]) {
        dict["[[prefill]]"] = dict["[[prefill]]"].replace(/\n<think>[\s\S]*/, "\n<think>\n<think>");
    }

    // Resolve early-evaluated tokens inside all other strings to prevent them from being missed and then cleaned up
    const earlyTokens = ["[[count]]", "[[DNRATIO]]", "[[img2]]", "[[v9_lean_min]]", "[[v9_lean_max]]", "[[v9_full_min]]", "[[v9_full_max]]"];
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
                    const dateStr = new Date(m.timestamp).toLocaleString();
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
                const dateStr = new Date(m.timestamp).toLocaleString();
                shortXML += `<archive_memory time="${dateStr}">[Msg ${m.id}]: ${m.summary}</archive_memory>\n`;
            });
            shortXML += "</recent_state_extracts>";

            const templateShort = (memCustom && memCustom.shortTermTemplate) || DEFAULT_PROMPTS.memoryCore.shortTermTemplate;
            dict["[[Short-memory]]"] = templateShort.replace('{{shortXML}}', shortXML);
        }
    }


    return dict;
}
