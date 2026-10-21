// ────────────────────────────────────────────────────────────────────────────
// Drawing the <Blocks> card into chat messages.
//
// What is left to draw: the NPC Bank's New NPC / NPC Update panes, and — for a
// reply Chomusuke read — the notebook card. The rest of the block system died
// with the Blocks tab; the export names stay because index.js, the side panel
// tab and the NPC flows are wired to them.
// ────────────────────────────────────────────────────────────────────────────

import { getContext } from "../../st.js";
import { extensionName } from "../../core/constants.js";
import { applyBlocksToMessage, clearBlocksFromMessage } from "../../blocks/render.js";
import { meguminRenderRegistry, meguminBlocksTakenByPanel } from "./registry.js";
// One directed edge from the blocks feature to the NPC feature. No cycle:
// nothing under features/npc/ imports the block card.
import { npcDecorateUpdatePane } from "../npc/updateCard.js";
import { npcDecorateNewPane } from "../npc/newCard.js";
import { notebookCardTextAt } from "../../state/index.js";
import { NOTEBOOK_CARD_DEFS, notebookDecoratePane, notebookCardStamp } from "../notebook/card.js";
import { notebookReadForReply } from "../notebook/worker.js";

// One message body, decorated or put back the way SillyTavern drew it.
//
// `msgIndex` is optional and only used to redraw the NPC Update tab from the
// changelog instead of from the model's raw text — see npcDecorateUpdatePane.
// A caller that does not know the index still gets a correct card, just without
// the undo buttons on that one tab.
export function meguminDecorateMessageBody(bodyEl, mesText, msgIndex) {
    try {
        // Plan 010: notebook lines Chomusuke wrote for this reply (not in its text).
        const storeBlocks = {};
        const nbText = typeof msgIndex === "number" ? notebookCardTextAt(msgIndex) : "";
        if (nbText) storeBlocks.Notebook_Update = nbText;
        // The notebook's blocks are drawn (behind a spoiler) on every reply that
        // wrote one, on or off.
        applyBlocksToMessage(bodyEl, mesText, [...meguminRenderRegistry(), ...NOTEBOOK_CARD_DEFS], {
            msgIndex,
            storeBlocks,
            // Drawn from the store, so a Revert changes the card without the text.
            extraStamp: typeof msgIndex === "number" ? notebookCardStamp(msgIndex) : "",
            omit: meguminBlocksTakenByPanel()
        });
        if (typeof msgIndex === "number") {
            // The card renderer stays generic — it knows nothing about NPCs. The
            // pane it produced is found by the block id and handed to the NPC
            // feature to fill in.
            const pane = bodyEl.querySelector('.meg-block-body[data-block-id="npcUpdate"]');
            if (pane) npcDecorateUpdatePane(pane, msgIndex);
            // New NPC: one tab per dossier, each with "Open in NPC Bank".
            bodyEl.querySelectorAll('.meg-block-body[data-block-id="newNpc"]').forEach(p => npcDecorateNewPane(p));
            bodyEl.querySelectorAll('.meg-block-body[data-block-id="notebook"], .meg-block-body[data-block-id="notebookUpdate"]')
                .forEach(p => notebookDecoratePane(p, msgIndex, {
                    onChanged: () => meguminScheduleBlocksRefresh(),
                    onReread: () => { notebookReadForReply(msgIndex, { force: true }); }
                }));
        }
    } catch (e) {
        // Fail visible: the reader keeps the raw block text, which is exactly
        // what they had before this existed.
        try { clearBlocksFromMessage(bodyEl); } catch (e2) { /* nothing left to do */ }
        console.debug(`[${extensionName}] block renderer skipped a message`, e);
    }
}

// Every rendered message in the chat, matched back to its raw text by mesid.
// The DOM is only ever the place the card goes — what gets rendered is read from
// chat[i].mes, because the tags this all keys on are gone from the DOM.
export function meguminRefreshBlocksInChat() {
    let ctx = null;
    try { ctx = typeof getContext === "function" ? getContext() : null; } catch (e) { return; }
    const chat = ctx && ctx.chat;
    if (!Array.isArray(chat)) return;

    document.querySelectorAll("#chat .mes").forEach(mesEl => {
        const idx = parseInt(mesEl.getAttribute("mesid"), 10);
        if (Number.isNaN(idx) || !chat[idx]) return;
        const msg = chat[idx];
        if (msg.is_user || msg.is_system) return;

        const bodyEl = mesEl.querySelector(".mes_text");
        if (!bodyEl) return;
        // A message being edited has SillyTavern's textarea parked in its body.
        // Decorating that would fight the editor and could eat the edit.
        if (bodyEl.querySelector("textarea")) { clearBlocksFromMessage(bodyEl); return; }

        meguminDecorateMessageBody(bodyEl, msg.mes, idx);
    });
}

export let meguminBlocksRefreshTimer = null;
// Several things rebuild .mes_text — SillyTavern on edit and swipe, other
// extensions on their own timers. Every one of them drops the card and the
// hiding with it, so every path that can rebuild a body funnels through here,
// and the coalescing keeps a burst of them to one pass rather than one pass each.
export function meguminScheduleBlocksRefresh(delay = 60) {
    if (meguminBlocksRefreshTimer) clearTimeout(meguminBlocksRefreshTimer);
    meguminBlocksRefreshTimer = setTimeout(() => {
        meguminBlocksRefreshTimer = null;
        meguminRefreshBlocksInChat();
    }, delay);
}
