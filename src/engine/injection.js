// ────────────────────────────────────────────────────────────────────────────
// The prompt interceptor — the last thing to touch the messages before they go.
//
// Reads the in-flight request markers to decide which prompt shape to emit: the
// roleplay one, or one of the background tasks (ban list, memory summary).
// Everything it needs is already a module.
// ────────────────────────────────────────────────────────────────────────────

import { substituteParams } from "../st.js";
import { getContext } from "../st.js";
import { extensionName } from "../core/constants.js";
import { localProfile } from "../core/state.js";
import {
    activeMemorySummarizationRequest,
} from "../core/activeRequests.js";
import { DEFAULT_PROMPTS } from "../prompts/index.js";
import { memEnsureSemanticQueryFresh } from "../features/memory/vectordb.js";
import { escapeRegex } from "../utils/regex.js";
import { buildBaseDict } from "./buildBaseDict.js";
import { meguminAllSlotTriggers } from "../../data/slots.js";

// Every prompt goes through here: the placeholder dictionary is built and
// written over the messages.
export async function handlePromptInjection(data, type) {
    await buildPromptInjection(data, type);
}

async function buildPromptInjection(data, type) {
    const messages = data?.messages || data?.chat || (Array.isArray(data) ? data : null);
    if (!messages || !Array.isArray(messages)) return;
    // Utility prefills are gone with the Ban List: only the memory summary and
    // the style order still speak for themselves, and neither benefited.
    // (The old toggle lived under globalSettings.enableUtilityPrefill.)

    // --- INJECT MEMORY SUMMARIZATION PROMPT ---
    if (activeMemorySummarizationRequest) {
        messages.length = 0;

        // The language field died with the Language & Add-ons tab. Summaries
        // answer in whatever language the chat itself is using.
        const targetLang = "the same language used in the chat history";

        const memCustom = localProfile.memoryCore.customPromptsEnabled ? localProfile.memoryCore.customPrompts : null;
        const sys = (memCustom && memCustom.systemPrompt) || DEFAULT_PROMPTS.memoryCore.systemPrompt;
        const userTask = (memCustom && memCustom.userPrompt) || DEFAULT_PROMPTS.memoryCore.userPrompt;

        messages.push({
            "role": "system",
            "content": sys.replace('{{targetLang}}', targetLang)
        });
        messages.push({
            "role": "user",
            "content": userTask.replace('{{chatHistory}}', activeMemorySummarizationRequest).replace('{{targetLang}}', targetLang)
        });

        console.log(`[${extensionName}] 🎯 Injected Memory Summarization array in memory.`);
        return;
    }

    if (!localProfile) return;
    // Master switch off: the roleplay prompt goes out exactly as SillyTavern
    // built it, [[placeholders]] and old blocks included.
    if (!suiteEnabled()) return;

    // Semantic memory retrieval is a network call fired on a debounce, so without
    // waiting here the prompt can be assembled from the previous turn's matches.
    // No-ops unless the search text actually changed, so swipes and regenerations
    // do not pay for it. Only on the real generation path — the token counter and
    // the prompt preview call buildBaseDict(true) and never reach this line.
    try { await memEnsureSemanticQueryFresh(); } catch (e) {
        console.warn("[Vellum] Semantic refresh before prompt build failed; using what is in hand.", e);
    }

    const dict = buildBaseDict();

    // Hide blocks from the AI (plan 8): the blocks system is gone. Old replies in
    // the chat still carry the envelope and its children; strip them so the model
    // never reads its own old cards. Done before the placeholders are filled, so
    // the [[blocks]] template the preset carries is never touched — only the
    // replies already in the chat.
    if (localProfile.hideBlocksFromAI !== false) {
        const tags = ["Blocks", "Dice", "World_State", "World_Update", "CYOA", "NPC_Inner_Chatter",
            "Bonds", "Character_Sheet", "Story_Tracker", "New_NPC", "NPC_Update",
            "Notebook", "Notebook_Update"];
        const hidden = hideBlocksInMessages(messages, tags);
        if (hidden) console.debug(`[${extensionName}] Hid the blocks in ${hidden} earlier repl${hidden === 1 ? "y" : "ies"} from the model.`);
    }

    let replacementsMade = 0;
    for (const msg of messages) {
        if (msg.content && typeof msg.content === 'string') {
            Object.entries(dict).forEach(([trigger, replacement]) => {
                if (msg.content.includes(trigger)) {
                    const processed = typeof substituteParams === 'function' ? substituteParams(replacement) : replacement;

                    // If the replacement is empty, remove the tag AND the empty line it sits on
                    if (processed.trim() === "") {
                        msg.content = msg.content.replace(new RegExp(`^[ \\t]*${escapeRegex(trigger)}[ \\t]*\\r?\\n?`, 'gm'), "");
                    }

                    // Standard replacement for everything else
                    msg.content = msg.content.replace(new RegExp(escapeRegex(trigger), 'g'), processed);
                    replacementsMade++;
                }
            });

            // Cleanup unused tags (removes the tag AND the line break it sits on).
            //
            // This was a 60-string array written out by hand, and it was the third
            // copy of the placeholder list. It is the one whose failure is worst:
            // a tag missing from here does not blank, it leaks a literal
            // "[[whatever]]" straight into the model's context. Derived from
            // MEGUMIN_SLOT_REGISTRY now, so a new slot cannot be forgotten here.
            meguminAllSlotTriggers().forEach(tr => {
                    if (msg.content.includes(tr)) {
                    msg.content = msg.content.replace(new RegExp(`^[ \\t]*${escapeRegex(tr)}[ \\t]*\\r?\\n?`, 'gm'), "");
                    msg.content = msg.content.replace(new RegExp(escapeRegex(tr), 'g'), ""); // Catch-all for inline tags
                }
            });

            // Cleanup Inline Image Artifacts so the AI doesn't see raw HTML
            msg.content = msg.content.replace(/<img[^>]*?alt=["']KazumaInline["'][^>]*?>/gi, "");
            msg.content = msg.content.replace(/<div[^>]*?title=["']KazumaFail\|[^>]*?>.*?<\/div>/gi, "");
            
            // Comprehensive Image Block Cleanup
            msg.content = msg.content.replace(/<img\s+[^>]*\/>|<div class="kazuma-img-placeholder"[^>]*>[\s\S]*?<\/div>|<!-- kazuma-inline-start:[^>]*-->[\s\S]*?<!-- kazuma-inline-end:[^>]*-->/gi, "");

            // Final Sweep: Collapse 3 or more blank lines into a standard double line break
            msg.content = msg.content.replace(/(?:\r?\n[ \t]*){3,}/g, '\n\n');
        }
    }

    if (replacementsMade > 0) {
        console.log(`[${extensionName}] ✅ Executed ${replacementsMade} block replacements.`);
    }
}
