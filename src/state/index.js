// ────────────────────────────────────────────────────────────────────────────
// State store ↔ SillyTavern.
//
// The one place that knows both sides: builds the store over the open chat's
// metadata, answers the prompt builder and the card renderer, and turns ST's
// chat events into store calls.
//
// Only the notebook is kept now — the world, bonds, sheet, chatter, tracker and
// cyoa modules died with the Blocks feature. The store and this file's name
// stay generic so old chats with a megumin_state root keep loading; any other
// module's journal entries in it are simply ignored.
// ────────────────────────────────────────────────────────────────────────────

import { getContext, saveMetadataDebounced, saveChatDebounced, substituteParams, extension_settings } from "../st.js";
import { extensionName } from "../core/constants.js";
import { engineKeepsNotebook } from "../core/engines.js";
import { hardcodedLogic } from "../../data/database.js";
import { localProfile } from "../core/state.js";
import { createStateStore } from "./store.js";
import { notebookModule } from "./modules/notebook/index.js";
import {
    notebookPhase, renderNotebookSetup, renderNotebookForPrompt, renderNotebookUpdateRules, notebookTurnLabeler
} from "./modules/notebook/render.js";
import { liveTruths } from "./modules/notebook/model.js";
import { parseNotebook } from "./modules/notebook/parse.js";
import {
    replyWroteNotebookChanges, notebookAnswerBlock, joinNotebookRead, notebookReadPart, parseNotebookRead
} from "./modules/notebook/worker.js";

function sub(text) {
    try { return typeof substituteParams === "function" ? substituteParams(text) : text; } catch (e) { return text; }
}

const adapter = {
    getChat: () => getContext()?.chat || [],
    getMeta: () => {
        const ctx = getContext();
        if (!ctx || !ctx.chatId) return null;   // no chat open: nowhere to keep state
        return ctx.chatMetadata || null;
    },
    saveMeta: () => saveMetadataDebounced(),
    saveChat: () => saveChatDebounced()
};

export const stateStore = createStateStore({
    adapter,
    modules: { notebook: notebookModule }
});

// Turns store changes into a card redraw without dragging the renderer up here.
let stateChangedHook = () => {};

/** Called whenever a background extraction starts or lands (cards redraw). */
export function setWorldStateChangedHook(fn) {
    stateChangedHook = typeof fn === "function" ? fn : () => {};
}

function hashText(t) {
    let h = 5381;
    const s = String(t || "");
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + ":" + s.length;
}

function swipeText(msg, swipe) {
    if (Array.isArray(msg.swipes) && typeof msg.swipes[swipe] === "string") return msg.swipes[swipe];
    const cur = typeof msg.swipe_id === "number" ? msg.swipe_id : 0;
    return cur === swipe ? String(msg.mes || "") : null;
}

function findTokenMessage(token) {
    const chatNow = adapter.getChat();
    const at = chatNow.findIndex(m => m?.extra?.megumin_uid === token.uid);
    const textNow = at >= 0 ? swipeText(chatNow[at], token.swipe) : null;
    const same = getContext()?.chatId === token.chatId && at >= 0 && textNow != null && hashText(textNow) === token.hash;
    return same ? at : -1;
}

export const NOT_A_REPLY = new Set(["first_message", "command", "impersonate", "quiet"]);

// ── Author's Notebook ─────────────────────────────────────────────────────
// The hidden truths the story model keeps: it writes them after its reply
// (<Notebook> at setup, <Notebook_Update> after), the store keeps them per
// message and swipe, and they come back every turn in Current Info.
//
// On for an engine that keeps one (V11: `notebook: true`), or by the switch.
// There is no per-chat pause any more (it was removed with the tab's "Pause in
// this chat"): V11's text always speaks of its notebook, so it must always have
// one. An old chat's `megumin_notebook.paused` flag is simply ignored.

function activeEngine() {
    const custom = (extension_settings[extensionName] && extension_settings[extensionName].customModes) || [];
    return [...(hardcodedLogic.modes || []), ...custom].find(m => m.id === localProfile?.mode) || null;
}

/** The engine turns the notebook on by itself (the switch can't turn it off). */
export function notebookForcedByEngine() {
    return engineKeepsNotebook(activeEngine());
}

export function notebookEnabled() {
    if (!localProfile) return false;
    return notebookForcedByEngine() || Boolean(localProfile.notebook && localProfile.notebook.enabled);
}

export function notebookState() {
    return stateStore.getState("notebook");
}

/** "setup", "running" or "off" for the open chat. */
export function notebookCurrentPhase() {
    if (!adapter.getMeta()) return "off";
    return notebookPhase(notebookState(), { on: notebookEnabled() });
}

/** <Author_Notebook> for Current Info, or "". */
export function notebookPromptBlock() {
    if (notebookCurrentPhase() !== "running") return "";
    return sub(renderNotebookForPrompt(notebookState()));
}

/**
 * What the <Blocks> envelope asks for: the setup, or the update rules. null when off.
 * @returns {{ rules: string, template: string, phase: string } | null}
 */
export function notebookBlockRequest() {
    const phase = notebookCurrentPhase();
    if (phase === "setup") {
        return { phase, rules: sub(renderNotebookSetup()), template: "<Notebook>\n[two or three truths, each in the form above]\n</Notebook>" };
    }
    if (phase === "running") {
        // With the Chomusuke route on, the story model only writes new truths.
        const newOnly = notebookViaChomusuke();
        return {
            phase,
            rules: sub(renderNotebookUpdateRules({ newOnly })),
            template: newOnly
                ? "<Notebook_Update>\n[a new truth with its lines; leave this block out when there is none]\n</Notebook_Update>"
                : "<Notebook_Update>\n[change lines; leave this block out when nothing changed]\n</Notebook_Update>"
        };
    }
    return null;
}

/** Chomusuke reads each reply for clues, who learned what, and what came out (Chomusuke tab: Notebook route). */
export function notebookViaChomusuke() {
    const c = localProfile && localProfile.chomusuke;
    if (!c || !c.enabled || !c.profileId || !c.features || c.features.notebook !== true) return false;
    return notebookEnabled();
}

/**
 * What one message's shown swipe did to the notebook, for its card.
 * @returns {null | { entry: object, applied: object[], notes: string[], truths: object, disabled: boolean }}
 *   truths — the notebook right after the message, to draw the truths it wrote
 */
export function notebookCardInfo(msgIndex) {
    if (!adapter.getMeta()) return null;
    const msg = adapter.getChat()[msgIndex];
    const uid = msg?.extra?.megumin_uid;
    if (!msg || msg.is_user || !uid) return null;
    const swipe = typeof msg.swipe_id === "number" ? msg.swipe_id : 0;
    const pending = pendingNotebook.has(uid + ":" + swipe);
    const entry = stateStore.getEntryFor("notebook", uid, swipe);
    if (!entry && !pending) return null;
    const step = !entry || entry.disabled ? null : stateStore.getStep("notebook", uid);
    return {
        entry,
        applied: step?.applied || [],
        notes: step?.notes || [],
        truths: (step?.state || (entry ? stateStore.getStateAt("notebook", entry.seq) : {})).truths || {},
        disabled: Boolean(entry && entry.disabled),
        // Chomusuke's read: running now, done, or answered with nothing usable.
        pending,
        read: Boolean(entry && entry.source === "sidemodel"),
        missing: Boolean(entry && entry.source === "sidemodel" && entry.missing),
        // Only a reply that had live truths before it can be read for them.
        canRead: notebookViaChomusuke() && !pending && typeof msg.extra.megumin_seq === "number"
            && liveTruths(stateStore.getStateAt("notebook", msg.extra.megumin_seq - 0.5)).length > 0
    };
}

/**
 * What the card draws for a reply whose text has no notebook block but that
 * Chomusuke read: "" when there is no tab to draw (nothing changed).
 */
export function notebookCardTextAt(msgIndex) {
    const info = notebookCardInfo(msgIndex);
    if (!info || !(info.pending || info.read)) return "";
    if (info.pending) return "*Reading this reply for the notebook…*";
    if (info.missing) return "*Nothing usable came back for this reply. Use Read again.*";
    return info.applied.length || info.notes.length || info.disabled ? "*Notebook*" : "";
}

/** Turns a stored turn number into what the reader sees: "#15", "your edit", "a deleted message". */
export function notebookTurnLabel() {
    const seqToIndex = new Map();
    adapter.getChat().forEach((m, i) => {
        if (m && !m.is_user && typeof m.extra?.megumin_seq === "number") seqToIndex.set(m.extra.megumin_seq, i);
    });
    const userSeqs = new Set((stateStore.listEntries("notebook") || []).filter(x => x.entry.source === "user").map(x => x.entry.seq));
    return notebookTurnLabeler({ seqToIndex, userSeqs });
}

/** Revert (or restore) what one reply did to the notebook. */
export function notebookSetEntryDisabled(entryId, disabled) {
    return stateStore.setDisabled(entryId, disabled);
}

/**
 * A change from The Notebook tab (edit, forget, reveal, restore), kept as the
 * user's own entry so swipes and rewinds never undo it.
 */
export function notebookEdit(op) {
    if (!adapter.getMeta() || !op) return null;
    return stateStore.addUserEntry("notebook", { ops: [op] });
}

function notebookInPlay() {
    return Boolean(adapter.getMeta()) && (notebookEnabled() || stateStore.hasState("notebook"));
}

// Most replies write nothing to the notebook, so a reply with no block is not
// "missing" anything: nothing is recorded for it.
// A reply Chomusuke already read keeps Chomusuke's lines when its text is
// recorded again (an edit, a continue): only the reply's own part is re-read.
function notebookRecord(index) {
    const msg = adapter.getChat()[index];
    if (!msg || msg.is_user || msg.is_system) return false;
    const uid = msg.extra?.megumin_uid;
    const swipe = typeof msg.swipe_id === "number" ? msg.swipe_id : 0;
    const e = uid ? stateStore.getEntryFor("notebook", uid, swipe) : null;
    const part = e && e.source === "sidemodel" ? notebookReadPart(e.raw) : "";
    if (part) { fileNotebookRead(index, swipe, String(msg.mes || ""), part); return true; }
    const { recorded } = stateStore.recordMessage(index, { moduleIds: ["notebook"] });
    return recorded.length > 0;
}

// ── The notebook read ──
// Same shape the blocks read had: begin (claims the reply's swipe), notes
// (built when the worker is free), finish (files the answer, or drops it when
// the reply changed or is gone).

const pendingNotebook = new Set();

function fileNotebookRead(at, swipe, replyText, block) {
    const parsed = parseNotebookRead(replyText, block) || { kind: "delta", ops: [] };
    stateStore.recordMessage(at, { source: "sidemodel", moduleIds: ["notebook"], swipe, parsed, raw: joinNotebookRead(replyText, block) });
}

/**
 * Claims one reply for a notebook read. Null when there is nothing to read:
 * route off, no live truth before the reply (it was the setup), or the
 * reply wrote its own clue lines.
 */
export function notebookBeginRead(index, { force = false } = {}) {
    if (!notebookViaChomusuke() || !adapter.getMeta()) return null;
    const msg = adapter.getChat()[index];
    if (!msg || msg.is_user || msg.is_system) return null;
    const st = stateStore.stamp(msg);
    if (!st) return null;
    if (st.dirty) adapter.saveChat();
    const swipe = typeof msg.swipe_id === "number" ? msg.swipe_id : 0;
    const text = swipeText(msg, swipe);
    if (text == null || replyWroteNotebookChanges(text)) return null;
    if (!liveTruths(stateStore.getStateAt("notebook", st.seq - 0.5)).length) return null;
    const key = st.uid + ":" + swipe;
    if (pendingNotebook.has(key)) return null;
    const e = stateStore.getEntryFor("notebook", st.uid, swipe);
    if (!force && e && e.source === "sidemodel") return null;
    pendingNotebook.add(key);
    stateChangedHook();
    return { index, uid: st.uid, swipe, seq: st.seq, text, hash: hashText(text), key, chatId: getContext()?.chatId };
}

/** <Author_Notebook> as it stood before the reply, for the worker. */
export function notebookReadNotes(token) {
    return sub(renderNotebookForPrompt(stateStore.getStateAt("notebook", token.seq - 0.5)));
}

/**
 * Files Chomusuke's answer with the reply's own notebook lines.
 * @returns {{ ok: boolean, dropped: boolean }}
 */
export function notebookFinishRead(token, raw) {
    pendingNotebook.delete(token.key);
    const at = findTokenMessage(token);
    if (at < 0) {
        console.debug("[Megumin-Suite] Notebook read dropped: the reply changed or is gone.");
        stateChangedHook();
        return { ok: false, dropped: true };
    }
    const ans = notebookAnswerBlock(raw);
    if (!ans) { stateChangedHook(); return { ok: false, dropped: false }; }
    fileNotebookRead(at, token.swipe, token.text, ans.block);
    stateChangedHook();
    return { ok: true, dropped: false };
}

/** No usable answer: the reply's own lines stay, and the card offers Read again. */
export function notebookRecordMissing(token) {
    pendingNotebook.delete(token.key);
    const at = findTokenMessage(token);
    if (at < 0) { stateChangedHook(); return; }
    stateStore.recordMessage(at, { source: "sidemodel", expect: true, moduleIds: ["notebook"], swipe: token.swipe, parsed: parseNotebook(token.text) });
    stateChangedHook();
}

/** Gives up a claimed read without filing anything. */
export function notebookAbandonRead(token) {
    if (token) pendingNotebook.delete(token.key);
    stateChangedHook();
}

// ── ST events ────────────────────────────────────────────────────────────
// Each returns true when something changed, so the caller can redraw cards.
// A chat that never used the store is left alone entirely.

export function stateOnMessageReceived(messageId) {
    if (!notebookInPlay()) return false;
    const chat = adapter.getChat();
    const index = typeof messageId === "number" ? messageId : chat.length - 1;
    stateStore.reconcile();
    return notebookRecord(index);
}

// Swiping switches which swipe's changes count; a swipe that was never
// recorded (older than this feature, or an alternate greeting) is parsed now.
// A swipe being generated is left to MESSAGE_RECEIVED — see store.onSwiped for
// why its text must not be read here.
export function stateOnSwiped(messageId) {
    if (!notebookInPlay()) return false;
    const chat = adapter.getChat();
    const index = typeof messageId === "number" ? messageId : chat.length - 1;
    stateStore.onSwiped(index, { moduleIds: ["notebook"] });
    return true;
}

export function stateOnSwipeDeleted(data) {
    if (!notebookInPlay() || !data) return false;
    stateStore.onSwipeDeleted(data.messageId, data.swipeId);
    stateStore.reconcile();
    return true;
}

export function stateOnEdited(messageId) {
    if (!notebookInPlay()) return false;
    return Boolean(notebookRecord(messageId));
}

export function stateOnDeleted() {
    if (!notebookInPlay()) return false;
    const { orphaned, dropped } = stateStore.reconcile();
    return orphaned.length > 0 || dropped.length > 0;
}

/** Chat opened or reloaded: square with deletions made meanwhile, one-time import. */
export function stateOnChatLoaded() {
    if (!notebookInPlay()) return false;
    stateStore.reparseStale("notebook");
    stateStore.reconcile();
    return true;
}
