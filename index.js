/* eslint-disable no-undef */
import { extension_settings, getContext } from "../../../extensions.js";
import {
    saveSettingsDebounced,
    generateQuietPrompt,
    event_types,
    eventSource,
    substituteParams,
    saveChat,
    reloadCurrentChat,
    addOneMessage,
    getRequestHeaders,
    appendMediaToMessage,
    updateMessageBlock,
} from "../../../../script.js";
import { saveBase64AsFile, cancelDebounce } from "../../../utils.js";
import { humanizedDateTime } from "../../../RossAscends-mods.js";
import { Popup, POPUP_TYPE } from "../../../popup.js";
import { hardcodedLogic } from "./data/database.js";

import { extensionName, extensionFolderPath } from "./src/core/constants.js";
import {
    localProfile,
    _loadedProfileKey,
    currentTab,
    setCurrentTab,
} from "./src/core/state.js";
import {
    activeMemorySummarizationRequest,
} from "./src/core/activeRequests.js";

import { DEFAULT_PROMPTS } from "./src/prompts/index.js";
import { meguminActiveDataIdentity, getCharacterKey, getRawAvatar, cleanGhostProfiles } from "./src/core/keys.js";
import { cleanLegacySettings, migrateRemovedFeatureKeys, dropLookResidue } from "./src/core/migrations.js";
import { meguminCompactStoredPrompts } from "./src/prompts/storage.js";
import { chomusukeSessionPromise } from "./src/engine/tasks.js";
import { renderPromptEditor } from "./src/ui/promptEditor.js";
import { registerRefreshHook, REFRESH } from "./src/core/refreshHooks.js";
import {
    initProfile,
    saveProfileToMemory,
    flushProfileSettingsToLoadedKey,
    saveProfileDebounced,
    _saveProfileDebouncedInner,
    pruneFutureData,
} from "./src/core/profile.js";
import {
    memProcessPendingChunks,
    isMessageArchived,
    updateMemoryVisuals,
} from "./src/features/memory/index.js";
import { memUpdateSemanticQueryDebounced, memEnsureSemanticQueryFresh } from "./src/features/memory/vectordb.js";
import { buildBaseDict } from "./src/engine/buildBaseDict.js";
import { cleanAIOutput } from "./src/engine/chatText.js";
import { handlePromptInjection } from "./src/engine/injection.js";
import { initDraggableButton, updateCharacterDisplay, discoverDefaultImages } from "./src/ui/launcher.js";
import { tabsUI, switchTab } from "./src/ui/tabs.js";

// Refresh hooks for the features still living in this file. Each registration
// moves into its own feature module as that feature is extracted — the memory
// ones have already gone with src/features/memory/.

// -------------------------------------------------------------
// STATE MANAGEMENT
// -------------------------------------------------------------
// Cross-cutting state now lives in src/core/state.js and
// src/core/activeRequests.js (imported at the top of this file). Reads below are
// unchanged — ES module live bindings keep them current — but reassignment goes
// through the setters. What remains here is state used ONLY by this file.




// -------------------------------------------------------------
// MASTER BLOCK RENDERING (chat side)
// -------------------------------------------------------------


// -------------------------------------------------------------
// BLOCKS TAB
// -------------------------------------------------------------


// Renders the preview through the same code the chat uses, from the last real
// reply when there is one and from the templates when there is not. A preview
// drawn by different code from the chat is worse than none, because it is
// confidently wrong.

// The field list for a stat block, editable in place under its row.



// -------------------------------------------------------------
// UI TAB RENDERER (Toolbox System)
// -------------------------------------------------------------


// Flips the toggle for the tab on screen. Turning it on pushes what is already
// there — a switch that only affected the NEXT edit would leave the tab you just
// set up out of step with every other character.

// Called after every profile save. This is the one place every change funnels
// through, which is what makes "any change in this tab is global" true rather
// than "every change I remembered to hook".





// -------------------------------------------------------------
// EVENT LISTENERS & INITS
// -------------------------------------------------------------


// -------------------------------------------------------------
// DRAGGABLE FIXED BUTTON WITH SNAP-TO-VIEWPORT & PERSISTENCE
// -------------------------------------------------------------

jQuery(async () => {
    try {
        // First: the settings live under a key named after the extension.
        cleanLegacySettings();
        migrateRemovedFeatureKeys();
        dropLookResidue();
        const h = await $.get(`${extensionFolderPath}/example.html`);
        $("body").append(h);
        initDraggableButton();
        $("body").append('<div id="ps-global-tooltip"></div>');
        // Profile level badge styles
        $("head").append(`<style>
            .ps-level-badge {
                display: inline-block;
                padding: 2px 8px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 600;
                color: #fff;
                margin-left: 8px;
                vertical-align: middle;
                letter-spacing: 0.3px;
                white-space: nowrap;
            }
            .ps-profile-badge {
                font-size: 11px;
                color: #9ca3af;
                margin-left: 6px;
            }
        </style>`);
        // Modify DOM to transition from Wizard -> Tabs
        $(".ps-breadcrumbs").hide();
        $("#ps_btn_prev, #ps_btn_next").hide();


        $("body").on("mouseenter", ".ps-modern-tag", function () { const hint = $(this).attr("data-hint"); if (!hint) return; const title = $(this).text().trim(); $("#ps-global-tooltip").html(`<span class="ps-tooltip-title">${title}:</span> ${hint}`).addClass("visible"); });
        $("body").on("mouseenter", "#ps_live_token_count", function (e) {
            const hint = $(this).attr("data-breakdown");
            if (!hint) return;
            $("#ps-global-tooltip").html(hint).addClass("visible");
        });
        $("body").on("mousemove", "#ps_live_token_count", function (e) {
            const tooltip = $("#ps-global-tooltip");
            // Position to the left of the mouse so it doesn't go off the screen!
            let x = e.clientX - tooltip.outerWidth() - 15;
            let y = e.clientY + 15;
            tooltip.css({ left: x + 'px', top: y + 'px' });
        });
        $("body").on("mouseleave", "#ps_live_token_count", function () {
            $("#ps-global-tooltip").removeClass("visible");
        });
        $("body").on("mousemove", ".ps-modern-tag", function (e) { if (!$(this).attr("data-hint")) return; const tooltip = $("#ps-global-tooltip"); let x = e.clientX + 15; let y = e.clientY + 15; if (x + tooltip.outerWidth() > window.innerWidth) x = e.clientX - tooltip.outerWidth() - 15; if (y + tooltip.outerHeight() > window.innerHeight) y = e.clientY - tooltip.outerHeight() - 15; tooltip.css({ left: x + 'px', top: y + 'px' }); });
        $("body").on("mouseleave", ".ps-modern-tag", function () { $("#ps-global-tooltip").removeClass("visible"); });

                // ── Mobile Sidebar Drawer System ──
        function closeMobileDrawer() {
            $(".dock").removeClass("mobile-open");
            $(".mobile-drawer-overlay").removeClass("open");
            // Small delay then hide overlay to allow transition
            setTimeout(() => {
                if (!$(".dock").hasClass("mobile-open")) {
                    $(".mobile-drawer-overlay").css("display", "none");
                }
            }, 350);
        }

        function openMobileDrawer() {
            $(".mobile-drawer-overlay").css("display", "block");
            // Force reflow before adding class so transition fires
            $(".mobile-drawer-overlay")[0]?.offsetHeight;
            $(".dock").addClass("mobile-open");
            $(".mobile-drawer-overlay").addClass("open");
        }

        function toggleMobileDrawer() {
            if ($(".dock").hasClass("mobile-open")) {
                closeMobileDrawer();
            } else {
                openMobileDrawer();
            }
        }

        function initMobileDrawer() {
            const container = $(".ps-modern-modal.app-container");
            if (!container.length) return;

            // Only inject once
            if (container.find(".mobile-drawer-overlay").length) return;

            // 1. Inject the dark backdrop overlay into the modal container
            container.append('<div class="mobile-drawer-overlay"></div>');

            // 2. Inject the hamburger button into the top-app-bar (before .app-actions)
            const topBar = container.find(".top-app-bar");
            if (topBar.length && !topBar.find(".mobile-hamburger").length) {
                topBar.prepend('<button class="mobile-hamburger" title="Menu"><i class="fa-solid fa-bars"></i></button>');
            }

            // 3. Inject a drawer header at top of dock (navigation label)
            const dock = container.find(".dock");
            if (dock.length && !dock.find(".mobile-drawer-header").length) {
                dock.prepend('<div class="mobile-drawer-header"><h3><i class="fa-solid fa-wand-magic-sparkles" style="margin-right:8px;color:var(--gold)"></i>Navigation</h3></div>');
            }

            // 5. Bind events
            // Hamburger toggle
            container.off("click.mobileHamburger").on("click.mobileHamburger", ".mobile-hamburger", function (e) {
                e.stopPropagation();
                toggleMobileDrawer();
            });

            // Backdrop click to close
            container.off("click.mobileOverlay").on("click.mobileOverlay", ".mobile-drawer-overlay", function () {
                closeMobileDrawer();
            });

        }

        // Tab click → switch tab AND close drawer on mobile
        $("body").on("click", ".sidebar-step", function () {
            const index = parseInt($(this).attr("id").replace("dot_", ""));
            if (!isNaN(index)) switchTab(index);
            // Close drawer on mobile after switching tab
            closeMobileDrawer();
        });

        // Initialize drawer elements when modal opens
        $("body").on("click", "#prompt-slot-fixed-btn", function () {
            // Slight delay to let the modal render
            setTimeout(initMobileDrawer, 100);
        });

        // Also init if already open (for reload scenarios)
        setTimeout(initMobileDrawer, 500);

        $("body").on("click", "#ps_btn_save_close", function () { saveProfileToMemory(); $("#prompt-slot-modal-overlay").fadeOut(200); toastr.success("Workflow Configured & Applied Successfully!"); });

        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            eventSource.on(event_types.APP_READY, () => {
                cleanGhostProfiles();
                meguminCompactStoredPrompts();
                discoverDefaultImages();
            });
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, handlePromptInjection);
            eventSource.on(event_types.CHAT_CHANGED, () => {
                // A save debounced at 500ms would die when initProfile swaps localProfile
                // below. Flush it under the OLD key first — settings only, because
                // chat_metadata already belongs to the chat we are switching TO.
                cancelDebounce(_saveProfileDebouncedInner);
                flushProfileSettingsToLoadedKey();
                // Defer profile loading — wait for ST context to fully initialize
                setTimeout(() => {
                    const ctx = getContext();
                    if (ctx.chatId || getRawAvatar()) {
                        initProfile(); updateCharacterDisplay();
                        if ($("#prompt-slot-modal-overlay").is(":visible")) switchTab(currentTab);
                    }
                }, 200);
                updateMemoryVisuals();
            });
            // Background Vectorization triggers for Semantic Mode
            // (not while the suite is switched off: each one is a network call)
            const memQueryIfOn = (...args) => { memUpdateSemanticQueryDebounced(...args); };
            eventSource.on(event_types.USER_MESSAGE_RENDERED, memQueryIfOn);
            eventSource.on(event_types.MESSAGE_EDITED, memQueryIfOn);
            eventSource.on(event_types.CHAT_CHANGED, memQueryIfOn);
            // Trigger visual update when user clicks "Show more messages"
            eventSource.on(event_types.MORE_MESSAGES_LOADED, updateMemoryVisuals);
            // Prune future data and roll back ledger on message deletion
            eventSource.on(event_types.MESSAGE_DELETED, () => {
                pruneFutureData();
            });
            // Handle swipe rewind & sync
            // Send guard: SillyTavern waits for this handler before it talks to
            // the API, so a reply sent while Chomusuke has the worker profile
            // switched in (switching in or back, when Send is still live) waits
            // for the main profile to return. Background (quiet) generations and
            // token-count dry runs pass straight through; 30s cap so a stuck
            // worker can never block the chat.
            eventSource.on(event_types.GENERATION_STARTED, async (genType, _params, dryRun) => {
                if (dryRun || genType === "quiet") return;
                const session = chomusukeSessionPromise();
                if (!session) return;
                toastr.info("Waiting a moment for Chomusuke to hand the connection back…", "Megumin Suite", { timeOut: 3000 });
                const gaveUp = await Promise.race([
                    session.then(() => false),
                    new Promise(r => setTimeout(() => r(true), 30000))
                ]);
                if (gaveUp) console.warn("[Vellum] Send guard: Chomusuke still busy after 30s; sending anyway.");
            });
            // REPLY ARRIVAL (reads, memory)
            eventSource.on(event_types.MESSAGE_RECEIVED, async (receivedId, receivedType) => {
                // Visible thinking is a leak, not a feature: providers without a
                // reasoning channel write <think> into the message itself, and
                // from there it is both shown to the reader and sent back as
                // context on the next turn. The edit lands before the save;
                // streaming has already drawn the raw text, so it is redrawn
                // below when the block was actually there.
                const received = getContext().chat?.[receivedId];
                if (received?.mes) {
                    const cleaned = cleanAIOutput(received.mes);
                    if (cleaned !== received.mes) {
                        received.mes = cleaned;
                        // Streaming has already drawn the raw text by the time
                        // this event fires; redraw it without the block.
                        updateMessageBlock(receivedId, received);
                    }
                }

                updateMemoryVisuals();

                // AUTO-TRIGGER MEMORY CORE
                const mem = localProfile?.memoryCore;
                if (mem && mem.enabled && (mem.triggerMode === 'frequency' || mem.triggerMode === 'every')) {
                    const chat = getContext().chat;
                    const aiMsgCount = chat.filter(m => !m.is_user && !m.is_system).length;

                    const freq = mem.triggerMode === 'every' ? 1 : (mem.autoFreq || 10);
                    if (aiMsgCount > 0 && aiMsgCount % freq === 0) {
                        // Check if we actually have enough messages to archive (avoid background notification spam)
                        let hasWork = false;
                        const workingLimit = mem.workingLimit || 30;
                        const chunkSize = mem.chunkSize || 10;
                        const realMessages = [];
                        for (let i = 0; i < chat.length; i++) {
                            if (!chat[i].is_system) realMessages.push({ originalIndex: i, msg: chat[i] });
                        }
                        if (realMessages.length > workingLimit) {
                            const archivableMessages = realMessages.slice(0, realMessages.length - workingLimit);
                            const unarchivedArchivable = archivableMessages.filter(item => !isMessageArchived(item.originalIndex, mem));
                            if (unarchivedArchivable.length >= chunkSize) {
                                hasWork = true;
                            }
                        }

                        if (hasWork) {
                            toastr.info("Background Memory Scan Triggered...", "Megumin Suite");
                            // We run it after a small delay so ST finishes saving the chat first
                            setTimeout(async () => {
                                await memProcessPendingChunks(true);
                            }, 3000);
                        }
                    }
                }

        });
        }

        // The floating button opens the settings window; clicking the backdrop or
        // the close button puts it away again, saving whatever was edited.
        $("body").on("click", "#prompt-slot-fixed-btn", function () { initProfile(); updateCharacterDisplay(); switchTab(0); $("#prompt-slot-modal-overlay").fadeIn(250).css("display", "flex"); });
        $("body").off("click", "#close-prompt-slot-modal, #prompt-slot-modal-overlay").on("click", "#close-prompt-slot-modal, #prompt-slot-modal-overlay", function (e) {
            if (e.target === this) {
                saveProfileToMemory();
                $("#prompt-slot-modal-overlay").fadeOut(200);
            }
        });

        // ── FLUSH PENDING SAVES ON TAB HIDE / PAGE CLOSE ──
        // visibilitychange fires reliably on tab switch AND on close (before pagehide).
        // pagehide is the last event before the page is truly gone.
        // A one-shot guard prevents the double-fire sequence from saving twice.
        let _meguminHideFlushed = false;
        function meguminFlushOnHide() {
            if (_meguminHideFlushed) return;
            _meguminHideFlushed = true;
            cancelDebounce(_saveProfileDebouncedInner);
            // With no chat open getCharacterKey() is null, and saveProfileToMemory()
            // falls back to the "default" key — so backgrounding the tab after closing
            // a chat used to overwrite the global default profile with whatever chat
            // was last loaded in memory. Only the full save may run while a chat is
            // genuinely open; otherwise hand off to the guarded settings-only flush,
            // which writes under the key the profile was loaded from and does nothing
            // at all unless the user actually has an edit pending.
            if (getCharacterKey()) {
                saveProfileToMemory();
            } else {
                flushProfileSettingsToLoadedKey();
            }
        }
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") {
                meguminFlushOnHide();
            } else {
                _meguminHideFlushed = false; // rearm on return to visible
            }
        });
        window.addEventListener("pagehide", meguminFlushOnHide);

        // ── DEFERRED PROFILE LOADER ──
        // Polls for context.chatId to become available after page load.
        // This ensures profiles load even when initProfile() runs before ST context is ready.
        (function deferredProfileLoader() {
            let attempts = 0;
            const maxAttempts = 30; // 30 * 500ms = 15 seconds max
            const loader = setInterval(() => {
                attempts++;
                const ctx = getContext();
                const chatId = ctx?.chatId;
                const avatar = getRawAvatar();
                if (chatId) {
                    clearInterval(loader);
                    initProfile();
                } else if (avatar && attempts >= 10) {
                    // Wait up to 5 seconds (10 attempts) for chatId to load before falling back to character level
                    clearInterval(loader);
                    initProfile();
                } else if (attempts >= maxAttempts) {
                    clearInterval(loader);
                    initProfile();
                }
            }, 500);
        })();
    } catch (e) { console.error(`[${extensionName}] Failed to load:`, e); }
});