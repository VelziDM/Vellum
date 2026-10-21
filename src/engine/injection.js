// ────────────────────────────────────────────────────────────────────────────
// The prompt interceptor — the last thing to touch the messages before they go.
//
// Reads the in-flight request markers to decide which prompt shape to emit: the
// roleplay one, or one of the background tasks (ban list, memory summary).
// Everything it needs is already a module.
// ────────────────────────────────────────────────────────────────────────────

import { extension_settings, substituteParams, Popup, POPUP_TYPE } from "../st.js";
import { getContext } from "../st.js";
import { extensionName } from "../core/constants.js";
import { localProfile } from "../core/state.js";
import {
    activeMemorySummarizationRequest, activeWorldExtractRequest,
    activeGenerationOrder, isBackgroundGenerationActive,
} from "../core/activeRequests.js";
import { DEFAULT_PROMPTS } from "../prompts/index.js";
import { meguminEnginePrompts } from "../prompts/meguminEngine.js";
import { memEnsureSemanticQueryFresh } from "../features/memory/vectordb.js";
import { escapeRegex } from "../utils/regex.js";
import { buildBaseDict } from "./buildBaseDict.js";
import { addThinkingNudge } from "./thinkingNudge.js";
import { meguminAllSlotTriggers } from "../../data/slots.js";
import { suiteEnabled } from "../core/power.js";
import { backgroundJobNow, reviewBackgroundPrompt } from "./bgPrompts.js";
import { loreForChat, loreForNames, loreBlock } from "../core/lore.js";

// Throttles the prompt-preview popup so token counting and rapid ST background
// triggers can't stack popups. Read and written only by the injection handler.
export let lastPromptPreviewTime = 0;

// Every prompt goes through here. A background job's messages are built by
// buildPromptInjection, then shown or logged (plan 013, engine/bgPrompts.js).
export async function handlePromptInjection(data, type) {
    const job = backgroundJobNow();
    await buildPromptInjection(data, type);
    if (!job) return;
    // Token counts and dry runs are not a call being sent.
    if (type === "count" || type === "dry" || type === "dryRun" || data?.dryRun === true || data?.dry === true) return;
    const messages = data?.messages || data?.chat || (Array.isArray(data) ? data : null);
    if (!messages || !Array.isArray(messages) || !messages.length) return;
    await reviewBackgroundPrompt(messages, job);
}

async function buildPromptInjection(data, type) {
    const messages = data?.messages || data?.chat || (Array.isArray(data) ? data : null);
    if (!messages || !Array.isArray(messages)) return;
    // Utility prefills are gone with the Ban List: only the memory summary and
    // the style order still speak for themselves, and neither benefited.
    // (The old toggle lived under globalSettings.enableUtilityPrefill.)

    // --- BACKGROUND EXTRACTION (Chomusuke side reads) ---
    // The whole prompt was built in advance (e.g. renderNotebookWorkerPrompt).
    if (activeWorldExtractRequest) {
        messages.length = 0;
        const r = activeWorldExtractRequest;
        messages.push({ "role": "system", "content": r.system });
        messages.push({ "role": "user", "content": r.user });
        console.log(`[${extensionName}] 🎯 Injected the background extraction prompt.`);
        return;
    }

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

    // --- MEGUMIN ENGINE TASK (Writing Style generator) ---
    // The whole prompt is the Megumin Engine one, built here, whatever preset the
    // connection has loaded: through Chomusuke the worker's own preset would
    // answer otherwise, and the order would never be read.
    if (activeGenerationOrder) {
        messages.length = 0;
        const E = meguminEnginePrompts;
        const card = ["{{description}}", "{{personality}}", "{{scenario}}"]
            .map(m => { try { return typeof substituteParams === "function" ? substituteParams(m) : ""; } catch (e) { return ""; } })
            .map(s => String(s || "").trim())
            .filter(s => s && !/^\{\{\w+\}\}$/.test(s))
            .join("\n\n");
        messages.push({ "role": "system", "content": E.main });
        messages.push({ "role": "user", "content": `${E.characterOpen}${card}\n${E.characterClose}` });
        messages.push({ "role": "user", "content": activeGenerationOrder });
        messages.push({ "role": "system", "content": E.thinking });
        console.log(`[${extensionName}] 🎯 Injected Megumin Engine prompt (Writing Style).`);
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
        console.warn("[Megumin Suite] Semantic refresh before prompt build failed; using what is in hand.", e);
    }

    const dict = buildBaseDict();

    if (localProfile.devOverrides) {
        Object.keys(localProfile.devOverrides).forEach(key => { if (dict[key] !== undefined) dict[key] = localProfile.devOverrides[key]; });
    }

    // --- THE ENVELOPE IS THE ONLY WAY IN ---
    // [[blocks]] carries every tracker block now. The per-block anchors are
    // blanked unconditionally: leaving them populated would emit each block
    // twice, once loose and once wrapped. A preset that has not been given a
    // [[blocks]] anchor emits no blocks at all, which is the intended, visible
    // failure rather than a silent fallback to a format nothing renders.
    //
    // [[npc_dossier]] is deliberately NOT blanked: it is the dossier RULES, not
    // the block, and the envelope's slot line refers back to them.
    ["[[infoblock]]", "[[infoblock2]]", "[[npc_inner_chatter]]", "[[npc_inner_chatter2]]",
        "[[storytracker]]", "[[storytracker2]]", "[[npc_dossier2]]"].forEach(t => { dict[t] = ""; });

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

    // Thinking Cap: its rules again as the last thing the model reads.
    if (addThinkingNudge(messages, localProfile.model)) {
        console.debug(`[${extensionName}] Added the Thinking Cap's rules at the end of the prompt.`);
    }

    if (replacementsMade > 0 && !activeGenerationOrder) {
        console.log(`[${extensionName}] ✅ Executed ${replacementsMade} block replacements.`);
    }

    // --- PROMPT PREVIEW ---
    const isBackgroundGen = isBackgroundGenerationActive();

    // Prevent double-popups from Token Counting or rapid ST background triggers
    const now = Date.now();
    const isSpam = (now - lastPromptPreviewTime) < 2000;
    
    // FIX: ST executes "Dry Runs" whenever you change a chat or tweak a setting to recalculate token limits.
    // We must ignore these so the preview doesn't pop up randomly!
    const isSilentOrDry = type === "count" || type === "quiet" || type === "dry" || type === "dryRun" || data?.dryRun === true || data?.dry === true;

    if (extension_settings[extensionName]?.globalSettings?.promptPreview && !isBackgroundGen && !isSilentOrDry && !isSpam) {
        lastPromptPreviewTime = now; // Lock it immediately

        let promptString = "";
        messages.forEach(m => {
            let contentStr = "";
            if (typeof m.content === "string") contentStr = m.content;
            else if (Array.isArray(m.content)) {
                // Handle multimodal image data safely
                contentStr = m.content.map(c => c.type === "text" ? c.text : "[BASE64 IMAGE DATA]").join("\n");
            }
            promptString += `========== [ ${m.role.toUpperCase()} ] ==========\n${contentStr}\n\n`;
        });

        const $content = $(`
            <div style="display:flex; flex-direction:column; gap:10px; font-family: 'Inter', sans-serif;">
                <div style="font-size: 0.85rem; color: var(--text-muted);">This is the exact payload being sent to the AI API.</div>
                <textarea class="ps-modern-input" readonly style="height: 450px; resize: vertical; font-family: monospace; font-size: 0.75rem; padding: 10px; white-space: pre-wrap; background: rgba(0,0,0,0.5);"></textarea>
            </div>
        `);
        $content.find("textarea").val(promptString);

        const { Popup, POPUP_TYPE } = typeof getContext === "function" ? getContext() : window;
        const popup = new Popup($content, POPUP_TYPE.CONFIRM, "Prompt Payload Preview", { okButton: "Send to AI", cancelButton: "Cancel", wide: true, large: true });

        const confirmed = await popup.show();

        if (!confirmed) {
            messages.length = 0; // Empty the payload
            toastr.info("Generation cancelled by user.");
            
            // FIX: Explicitly tell SillyTavern to abort to prevent Auto-Retry loops
            if (typeof window.stopGeneration === 'function') {
                window.stopGeneration();
            }
            // Fallback: visually click the stop buttons just in case
            setTimeout(() => {
                $("#mes_stop").trigger("click");
                $("#send_but_sheld").trigger("click");
            }, 10);
            
            return;
        }
    }
}
