// ──────────────────────────────────────────────────────────────────────────────
// Loading, saving and pruning the active profile.
//
// The whole extension's state lives in localProfile; this is the only module that
// builds it, writes it back to settings.json / chat metadata, and repairs it.
//
// It refreshes the tabs that a load or a prune invalidates through the hook
// registry rather than by calling renderers directly — see refreshHooks.js for
// why. That keeps every dependency here pointing down.
// ──────────────────────────────────────────────────────────────────────────────

import {
    getContext, extension_settings, saveSettingsDebounced, chat_metadata, saveMetadata,
    debounce, humanizedDateTime, isGenerating,
} from "../st.js";
import { extensionName } from "./constants.js";
import { localProfile, setLocalProfile, _loadedProfileKey, setLoadedProfileKey } from "./state.js";
import { getCharacterKey, getRawAvatar, getAvatarKey, getParentChatKey, getProfileLevel } from "./keys.js";
import { fireRefreshHook, REFRESH } from "./refreshHooks.js";
import { meguminSparsifyProfilePrompts, meguminRehydrateProfilePrompts } from "../prompts/storage.js";
import { DEFAULT_PROMPTS } from "../prompts/defaults.js";
import { hardcodedLogic } from "../../data/database.js";
import { normalizeStoryConfig, applyStoryConfigDefaults } from "../features/storyconfig/config.js";
import { escapeRegex } from "../utils/regex.js";

// Last chat_metadata stamp written, so an unchanged profile doesn't re-save.
export let _lastSavedMetaStamp = "";
// Set when a debounced profile save is scheduled; cleared whenever a save actually
// runs and after a fresh load. The chat-switch flush reads it, so a chat nobody
// edited never gets a profile written under its own key.
export let _profileSavePending = false;

export function initProfile() {
    const context = getContext();
    const chatLevelKey = getCharacterKey(); // Returns chat::xxx, group_xxx, avatar, or null
    const isGroup = context.groupId !== undefined && context.groupId !== null;

    // For non-group chats: try chat-level, then character-level (avatar), then default
    // For group chats: only group-level or default
    const profileLevel = isGroup ? 'group' : getProfileLevel();
    let activeKey = null;
    let fallbackKeys = [];

    if (isGroup) {
        activeKey = chatLevelKey; // group_xxx
    } else if (chatLevelKey) {
        // Priority: chat::xxx → parent_chat::xxx (if branch) → avatar → default
        activeKey = chatLevelKey;
        if (chatLevelKey.startsWith('chat::')) {
            fallbackKeys = [];
            // Add parent chat key if this is a branch
            const parentKey = getParentChatKey();
            if (parentKey) {
                fallbackKeys.push(parentKey);
            }
            // Add character-level (avatar) as final fallback for backward compatibility
            const avatarKey = getAvatarKey();
            if (avatarKey) fallbackKeys.push(avatarKey);
        }
    }

    if (!extension_settings[extensionName]) extension_settings[extensionName] = { profiles: {} };
    if (!extension_settings[extensionName].profiles) extension_settings[extensionName].profiles = {};
    if (!extension_settings[extensionName].customModes) {
        extension_settings[extensionName].customModes = [];
    }
    // Saved Story Config presets live globally so they follow the user across every character
    if (!extension_settings[extensionName].configPresets) {
        extension_settings[extensionName].configPresets = [];
    }

    const defaults = {
        mode: "balance",
        // Which engines have Enhanced Dialogue switched on, keyed by engine id.
        //
        // Per engine rather than one flag, because the switch is drawn inside the
        // engine card: a control that sits on the Ukiyo card and silently changes
        // Shura's card too is lying about its own scope. Only the active engine's
        // entry is ever read, so in practice a reader who never switches engines
        // sees a single on/off.
        enhancedDialogue: {},
        // The narrator voice is archived; the V7 module switches live on the
        // Preset & Thinking tab and seed their own keys.
        toggles: {},
        aiTags: [],
        aiGeneratedOptions: [],
        aiRule: "",
        customStyles: [],
        activeStyleId: null,
        storyConfig: {
            enabled: true,
            genre: "",
            tone: "",
            pov: "",
            pace: "",
            length: "",
            difficulty: "",
            friction: "",
            explicitness: "",
            narratorPresence: "",
            focus: "",
            culture: "",
            era: "",
            notes: ""
        },
        dnRatio: {
            enabled: false,
            dialogue: 50
        },
        model: "cot-v1-english",
        userNotes: "",
        customModes: [],
        thinkEffort: "unspecified",
        customThinkEffort: "100",
        // ponytail: image gen removed — the key is simply not created any more.
        // Old profiles may still carry an imageGen object; every reader left is
        // null-guarded, and the dead object is inert.
        // Same for storyPlan: the Story Director is gone with this build.
        memoryCore: {
            enabled: false,
            architecture: "raw_short_long", // "raw_short_long" or "raw_long"
            workingLimit: 30,
            shortTermLimit: 70,
            chunkSize: 10,
            backend: "direct",
            scannerEngine: "tfidf",
            triggerMode: "frequency",
            autoFreq: 10,
            shortTermChunks: [],
            longTermVault: [],
            customPrompts: null,
            customPromptsEnabled: false
        },
        chomusuke: {
            enabled: false,
            profileId: "",
            primaryProfileId: "",
            features: {
                memory: true,
                styleGen: true
            }
        },
        // The state lives in the chat file (chat_metadata.megumin_state), never here.
        // The notebook's study is nothing now.
        // Plan 008 keeps working: the story model reads Current Info, not its own
        // old blocks in the chat history.
        hideBlocksFromAI: true,
    };


    if (!extension_settings[extensionName].globalSettings) {
        extension_settings[extensionName].globalSettings = {
            promptPreview: false,
            enableUtilityPrefill: false,
            saveMode: "character"
        };
    } else if (!extension_settings[extensionName].globalSettings.saveMode) {
        extension_settings[extensionName].globalSettings.saveMode = "character";
    }

    if (!extension_settings[extensionName].profiles["default"]) {
        extension_settings[extensionName].profiles["default"] = JSON.parse(JSON.stringify(defaults));
    }

    // ── PROFILE LOADING: Try exact keys first, then fuzzy match all stored chat-level keys ──
    let profileFound = false;
    const avatarName = getRawAvatar();
    let keysToTry = [activeKey, ...fallbackKeys].filter(k => k);

    // Add avatar name as fallback if not already in the chain (for cross-format compatibility)
    if (avatarName && !keysToTry.includes(avatarName)) {
        keysToTry.push(avatarName);
    }

    // Step 1: Try exact key matches first
    for (const tryKey of keysToTry) {
        if (extension_settings[extensionName].profiles[tryKey]) {
            setLocalProfile(JSON.parse(JSON.stringify(extension_settings[extensionName].profiles[tryKey])));
            profileFound = true;
            activeKey = tryKey;

            if (tryKey.startsWith('chat::')) {
                // Check if this is a parent chat key (branch fallback)
                const isParent = (tryKey !== chatLevelKey && chatLevelKey && chatLevelKey.startsWith('chat::') && getParentChatKey() === tryKey);
                if (isParent) {
                    $("#ps_rule_status_main").css({ "color": "#818cf8", "text-shadow": "0 0 10px rgba(129,140,248,0.5)" }).text(`PARENT CHAT PROFILE (branch)`);
                } else {
                    $("#ps_rule_status_main").css({ "color": "#a855f7", "text-shadow": "0 0 10px rgba(168,85,247,0.5)" }).text(`CHAT PROFILE ACTIVE`);
                }
            } else if (isGroup) {
                $("#ps_rule_status_main").css({ "color": "#3b82f6", "text-shadow": "0 0 10px rgba(59,130,246,0.5)" }).text(`GROUP PROFILE ACTIVE`);
            } else {
                $("#ps_rule_status_main").css({ "color": "#10b981", "text-shadow": "0 0 10px rgba(16,185,129,0.5)" }).text(`CHARACTER PROFILE ACTIVE`);
            }
            break;
        }
    }



    // If no profile found in the chain, use defaults
    if (!profileFound) {
        setLocalProfile(JSON.parse(JSON.stringify(extension_settings[extensionName].profiles["default"])));

        if (isGroup) {
            $("#ps_rule_status_main").css({ "color": "#f59e0b", "text-shadow": "0 0 10px rgba(245,158,11,0.5)" }).text(`USING DEFAULT — no group profile`);
        } else if (activeKey && activeKey.startsWith('chat::')) {
            // Check if parent chat fallback exists
            const parentKey = getParentChatKey();
            if (parentKey && extension_settings[extensionName].profiles[parentKey]) {
                $("#ps_rule_status_main").css({ "color": "#f59e0b", "text-shadow": "0 0 10px rgba(245,158,11,0.5)" }).text(`USING PARENT CHAT PROFILE (fallback)`);
            } else {
                // Check if character fallback exists (use avatar name, not chatId)
                const charFallback = getRawAvatar();
                if (charFallback && extension_settings[extensionName].profiles[charFallback]) {
                    $("#ps_rule_status_main").css({ "color": "#f59e0b", "text-shadow": "0 0 10px rgba(245,158,11,0.5)" }).text(`USING CHARACTER PROFILE (fallback)`);
                } else {
                    $("#ps_rule_status_main").css({ "color": "#f59e0b", "text-shadow": "0 0 10px rgba(245,158,11,0.5)" }).text(`USING DEFAULT — no chat or character profile`);
                }
            }
        } else {
            $("#ps_rule_status_main").css({ "color": "#a855f7", "text-shadow": "0 0 10px rgba(168,85,247,0.5)" }).text(`MODIFYING GLOBAL DEFAULT`);
        }
    }

    // PATCH missing keys
    Object.keys(defaults).forEach(k => {
        if (localProfile[k] === undefined) localProfile[k] = defaults[k];
    });
    if (!localProfile.toggles) localProfile.toggles = {};
    // Story Config (replaces the old standalone POV dropdown and the legacy word count)
    if (!localProfile.storyConfig) localProfile.storyConfig = JSON.parse(JSON.stringify(defaults.storyConfig));
    Object.keys(defaults.storyConfig).forEach(k => {
        if (localProfile.storyConfig[k] === undefined) localProfile.storyConfig[k] = defaults.storyConfig[k];
    });
    normalizeStoryConfig(localProfile.storyConfig);
    // One-time migration: the old POV dropdown becomes the config's pov field
    if (localProfile.userPov && !localProfile.storyConfig.pov) {
        localProfile.storyConfig.pov = localProfile.userPov;
        localProfile.userPov = "";
    }
    // One-time migration: the old Target Word Count becomes the config's length field
    if (localProfile.userWordCount && String(localProfile.userWordCount).trim() !== "" && !localProfile.storyConfig.length) {
        const legacyType = localProfile.userWordCountType === "min" ? "minimum" : "maximum";
        localProfile.storyConfig.length = `${legacyType} ${String(localProfile.userWordCount).trim()} words`;
        localProfile.userWordCount = "";
    }
    // AFTER the two legacy migrations, never before: seeding pov would fill the very
    // field `if (!localProfile.storyConfig.pov)` tests, and an upgrading reader would
    // silently lose the POV they had set on the old dropdown.
    //
    // The block is always injected now, so its three standing fields ship set rather
    // than blank. Only fills what is empty, so a reader who picked something keeps it.
    applyStoryConfigDefaults(localProfile.storyConfig);
    if (localProfile.memoryCore && localProfile.memoryCore.customPromptsEnabled === undefined) localProfile.memoryCore.customPromptsEnabled = false;
    if (!localProfile.memoryCore) {
        localProfile.memoryCore = defaults.memoryCore;
    } else {
        if (localProfile.memoryCore.chunkSize === undefined) localProfile.memoryCore.chunkSize = 10;
    }
    if (!localProfile.dnRatio) localProfile.dnRatio = defaults.dnRatio;    if (!localProfile.chomusuke) {
        localProfile.chomusuke = JSON.parse(JSON.stringify(defaults.chomusuke));
    } else {
        if (localProfile.chomusuke.enabled === undefined) localProfile.chomusuke.enabled = false;
        if (localProfile.chomusuke.profileId === undefined) localProfile.chomusuke.profileId = "";
        if (localProfile.chomusuke.primaryProfileId === undefined) localProfile.chomusuke.primaryProfileId = "";
        if (!localProfile.chomusuke.features) {
            localProfile.chomusuke.features = {
                memory: true,
                styleGen: true
            };
        }
    }
    // Wave-off the keys of features that are gone. Inert: nothing reads them, and
    // old presets and archived exports keep whatever hand-written text they carried.
    if (localProfile.chomusuke?.features) {
        delete localProfile.chomusuke.features.worldState;
        delete localProfile.chomusuke.features.blocks;
    }
    if (localProfile.chomusuke) {
        delete localProfile.chomusuke.blockRoutes;
        delete localProfile.chomusuke.combine;
    }
    delete localProfile.worldState;
    // The blocks system is gone. Old profiles carried the stack order, the
    // per-block switch array and the stat field lists; nothing reads any of it.
    delete localProfile.blocks;
    delete localProfile.blockStack;
    delete localProfile.statBlocks;
    delete localProfile.npcBank;
    // The notebook state store lived in chat_metadata.megumin_state; nothing
    // writes or reads it any more, so it is dropped from the settings keys.
    // The chat-metadata copy is left alone: old chats keep loading, the entries
    // are inert.
    if (localProfile.state) delete localProfile.state;
    // The Persona tab is archived: the narrator voice and the two protocol
    // switches it owned.
    delete localProfile.personality;
    delete localProfile.toggles.ooc;
    delete localProfile.toggles.control;
    // The Dynamic Ban List is gone. Its keys die here on the live profile; the
    // settings.json sweep is migrateRemovedFeatureKeys().
    delete localProfile.banList;
    delete localProfile.banListBackend;
    delete localProfile.banListCustomPrompts;
    delete localProfile.banListCustomPromptsEnabled;

    // Prompt blocks are stored as a diff against DEFAULT_PROMPTS. Put the untouched keys
    // back before anything reads them. Runs after the patching above has guaranteed each
    // module container exists, so a profile saved before a module shipped is covered too.
    meguminRehydrateProfilePrompts(localProfile);

    // A profile written before Enhanced Dialogue existed has no map at all.
    if (!localProfile.enhancedDialogue || typeof localProfile.enhancedDialogue !== "object") {
        localProfile.enhancedDialogue = {};
    }

    // The Dev Mode overrides are gone with the Dev Mode. Old profiles carried
    // the map; nothing writes it any more.
    if (localProfile.devOverrides) {
        delete localProfile.devOverrides;
        saveSettingsDebounced();
    }

    // Captured BEFORE the migration blocks below run. A block that was already in this
    // chat's metadata on entry got there in an earlier session and survived a reload, so
    // the settings-side copy is provably redundant. A block this pass has only just
    // written is NOT counted: saveMetadata() could still fail, and the settings copy is
    // the sole remaining original until it lands. Those clean up on the next open.
    const metaHadOnEntry = {
        memory: !!(chat_metadata && chat_metadata["megumin_memory_core"])
    };

    if (chat_metadata && chat_metadata["megumin_memory_core"]) {
        if (localProfile.memoryCore) {
            localProfile.memoryCore.shortTermChunks = chat_metadata["megumin_memory_core"].shortTermChunks || [];
            localProfile.memoryCore.longTermVault = chat_metadata["megumin_memory_core"].longTermVault || [];
        }
    } else if (chat_metadata && localProfile.memoryCore && (localProfile.memoryCore.shortTermChunks?.length > 0 || localProfile.memoryCore.longTermVault?.length > 0)) {
        chat_metadata["megumin_memory_core"] = {
            shortTermChunks: localProfile.memoryCore.shortTermChunks || [],
            longTermVault: localProfile.memoryCore.longTermVault || []
        };
        saveMetadata();
    }

    // A chat-level profile whose only copy of its data sits in settings.json has
    // dropped it behind chat_metadata, so the residue there is dead weight and
    // gets freed once the chat's own metadata is confirmed to carry it.
    //
    // Only the exact chat-level key is touched. A character-level profile is shared by
    // every chat of that character and a parent-chat profile by every branch off it, so
    // one chat migrating its copy says nothing about the rest — clearing either would
    // destroy NPCs and memory belonging to chats that have not been opened yet. Those
    // keys keep their residue, which is the safe side to err on.
    if (chat_metadata && activeKey && activeKey === chatLevelKey && activeKey.startsWith('chat::')) {
        const stored = extension_settings[extensionName].profiles[activeKey];
        if (stored) {
            let freed = false;
            if (metaHadOnEntry.memory && stored.memoryCore
                && (stored.memoryCore.shortTermChunks !== undefined || stored.memoryCore.longTermVault !== undefined)) {
                delete stored.memoryCore.shortTermChunks;
                delete stored.memoryCore.longTermVault;
                freed = true;
            }
            // The removed Story Director and image gen. Old profiles carry orphaned
            // keys quietly; shave them off when they are actually there.
            if (stored.imageGen && stored.imageGen.characterTags !== undefined) {
                delete stored.imageGen.characterTags;
                freed = true;
            }
            if (stored.storyPlan) {
                delete stored.storyPlan;
                freed = true;
            }
            if (freed) saveSettingsDebounced();
        }
    }

    let displayName = "Global Default";
    if (isGroup) {
        if (context.groups && Array.isArray(context.groups)) {
            const group = context.groups.find(g => String(g.id) === String(context.groupId));
            if (group && group.name) displayName = group.name;
            else displayName = `Group Chat (${context.groupId})`;
        } else { displayName = "Group Chat"; }
    } else if (chatLevelKey && context.characterId !== undefined && context.characters[context.characterId]) {
        displayName = context.characters[context.characterId].name;
    }

    const saveLevel = getProfileLevel();
    const levelIcons = { chat: '🎯', character: '👤', group: '👥', global: '⚙️' };
    const levelLabels = { chat: 'Chat', character: 'Character', group: 'Group', global: 'Global' };
    const levelColors = { chat: '#a855f7', character: '#3b82f6', group: '#f59e0b', global: '#6b7280' };
    
    if (isGroup) {
        $("#ps_char_rule_label").html(`${displayName} <span class="ps-level-badge" style="background:${levelColors[saveLevel]};">${levelIcons[saveLevel]} ${levelLabels[saveLevel]}</span>`);
    } else {
        $("#ps_char_rule_label").html(`${displayName} <span class="ps-level-badge" style="background:${levelColors[saveLevel]};">${levelIcons[saveLevel]} ${levelLabels[saveLevel]}</span>`);
    }
    fireRefreshHook(REFRESH.TOKEN_COUNT);
    pruneFutureData(); // Automatically prune out-of-bounds future data on load/initialization
    fireRefreshHook(REFRESH.MEMORY_VISUALS);

    // Remember the key this profile came from, so a save still pending when the
    // chat switches can be flushed to it after ST has moved on to the next chat.
    setLoadedProfileKey(chatLevelKey || "default");
    // Fresh profile in memory — nothing the user typed is waiting to be written.
    _profileSavePending = false;
}

export function pruneFutureData() {
    const context = typeof getContext === "function" ? getContext() : null;
    
    // FIX 1: Ensure chat is fully loaded and not empty
    if (!context || !Array.isArray(context.chat) || context.chat.length === 0) return;
    
    // FIX 2: Skip pruning if SillyTavern is currently generating (fixes swipe/regenerate bug)
    if (typeof isGenerating === "function" && isGenerating()) return; 

    const chatLength = context.chat.length;
    let changesMade = false;

    // 1. Prune Memory Core Chunks
    const mem = localProfile?.memoryCore;
    if (mem) {
        if (mem.shortTermChunks && mem.shortTermChunks.length > 0) {
            const originalLength = mem.shortTermChunks.length;
            mem.shortTermChunks = mem.shortTermChunks.filter(chunk => {
                const parts = chunk.id.split("-");
                if (parts.length < 2) return true; 
                return parseInt(parts[1]) < chatLength;
            });
            if (mem.shortTermChunks.length !== originalLength) {
                changesMade = true;
                delete mem._archivedSet;
                mem._tokensDirty = true;
            }
        }

        if (mem.longTermVault && mem.longTermVault.length > 0) {
            const originalLength = mem.longTermVault.length;
            mem.longTermVault = mem.longTermVault.filter(chunk => {
                const parts = chunk.id.split("-");
                if (parts.length < 2) return true;
                return parseInt(parts[1]) < chatLength;
            });
            if (mem.longTermVault.length !== originalLength) {
                changesMade = true;
                delete mem._archivedSet;
                mem._tokensDirty = true;
            }
        }
    }

    // 2b. Rebalance the working window.
    //
    // The prune above only drops chunks that point PAST the end of the chat.
    // Rewinding also moves the working-limit cutoff backwards over messages that
    // were archived while the chat was longer — those stay in _archivedSet, so
    // they remain dimmed in the UI and stripped from the prompt by the memory
    // interceptor, with no way back except pressing "Apply & Extract Pending".
    // Hand them back automatically instead.
    if (fireRefreshHook(REFRESH.MEMORY_SCRUB_OVERLAPS)) {
        changesMade = true;
    }

    if (changesMade) {
        saveProfileToMemory();
        console.log(`[Megumin Suite] Pruned/Adjusted out-of-bounds future data (chat length: ${chatLength})`);
        
        fireRefreshHook(REFRESH.MEMORY_ACCORDION);
        fireRefreshHook(REFRESH.MEMORY_VAULT, $("#mem_vault_search").val() || "");
        fireRefreshHook(REFRESH.MEMORY_DASHBOARD);
        fireRefreshHook(REFRESH.MEMORY_VISUALS);
    }
}

export function saveProfileToMemory() {
    const key = getCharacterKey() || "default";

    // `key` is the live truth; localProfile belongs to _loadedProfileKey, which is set in
    // the same synchronous block as localProfile itself. They disagree whenever the chat
    // has moved on but the profile has not caught up yet (initProfile runs 200ms after
    // CHAT_CHANGED) or when a long await outlived a chat switch. Decline the whole save
    // instead of quietly redirecting it to _loadedProfileKey: that is the kind of guesswork
    // that caused the earlier flush bug, and the caller may be holding data that is stale
    // in its own right. _profileSavePending is deliberately left alone so
    // flushProfileSettingsToLoadedKey() can still write the settings half under the key
    // the data actually belongs to; initProfile clears the flag when the next profile
    // loads, so it cannot leak into an untouched chat.
    if (_loadedProfileKey && key !== _loadedProfileKey) {
        console.debug(`[Megumin-Suite] saveProfileToMemory declined: the profile in memory belongs to "${_loadedProfileKey}" but the active chat is now "${key}". Skipping the chat_metadata blocks and the settings write so this chat's data is not saved into another chat.`);
        return;
    }

    _profileSavePending = false;
    const ruleBox = $("#ps_main_current_rule");
    if (ruleBox.length > 0) { localProfile.aiRule = ruleBox.val(); }

    // Invalidate the optimized archived-set cache when profile changes
    if (localProfile?.memoryCore) {
        localProfile.memoryCore._archivedSet = null;
        fireRefreshHook(REFRESH.MEMORY_CACHE_INVALIDATE);
    }

    // Save current avatar/character identifier inside the profile for identification/fuzzy matching
    if (key.startsWith('chat::')) {
        const avatar = getRawAvatar();
        if (avatar) {
            localProfile.chatAvatar = avatar;
        }
    }

    if (chat_metadata) {
        const mem = localProfile.memoryCore;

        // Write a block if it has content now, or if the key already exists on the chat.
        // The second half is what keeps a deletion, and a bank left empty by the
        // settings.json migration in initProfile, from being skipped.
        if (mem && ((mem.shortTermChunks?.length > 0) || (mem.longTermVault?.length > 0)
            || chat_metadata["megumin_memory_core"] !== undefined)) {
            if (!chat_metadata["megumin_memory_core"]) chat_metadata["megumin_memory_core"] = {};
            chat_metadata["megumin_memory_core"].shortTermChunks = mem.shortTermChunks || [];
            chat_metadata["megumin_memory_core"].longTermVault = mem.longTermVault || [];
        }

        const hasAnyBlock = !!(chat_metadata["megumin_memory_core"]
            || chat_metadata["megumin_npc_bank"]);

        if (hasAnyBlock) {
            // chat_metadata ends up holding the same array objects as localProfile, so
            // comparing the two would report "equal" even right after a push. Compare
            // against the last thing that actually went to disk instead. `key` is in the
            // stamp so switching chats cannot reuse a stale one.
            const metaStamp = key + "|" + JSON.stringify([
                chat_metadata["megumin_memory_core"] || null,
                chat_metadata["megumin_npc_bank"] || null
            ]);
            if (metaStamp !== _lastSavedMetaStamp) {
                _lastSavedMetaStamp = metaStamp;
                saveMetadata();
            }
        }
    }

    const profileToSave = JSON.parse(JSON.stringify(localProfile));
    if (profileToSave.memoryCore) {
        delete profileToSave.memoryCore.shortTermChunks;
        delete profileToSave.memoryCore.longTermVault;
    }
    }
    if (profileToSave.imageGen) {
        delete profileToSave.imageGen.characterTags; // DO NOT save characterTags in settings.json!
    }

    // Drop prompt text that matches DEFAULT_PROMPTS. Safe on profileToSave because it is
    // already a clone; localProfile keeps the full text the editor is bound to.
    meguminSparsifyProfilePrompts(profileToSave);

    extension_settings[extensionName].profiles[key] = profileToSave;
    saveSettingsDebounced();

    fireRefreshHook(REFRESH.TOKEN_COUNT); // NEW: Update the UI whenever settings are saved!

    const saveInd = $("#ps_save_indicator");
    if (saveInd.length) {
        const level = getProfileLevel();
        const levelIcons = { chat: '🎯', character: '👤', group: '👥', global: '⚙️' };
        const levelLabels = { chat: 'Chat', character: 'Character', group: 'Group', global: 'Global' };
        saveInd.html(`<i class="fa-solid fa-check"></i> Saved <span class="ps-profile-badge">${levelIcons[level]} ${levelLabels[level]}</span>`).fadeIn(150);
        clearTimeout(window.psSaveTimer);
        window.psSaveTimer = setTimeout(() => saveInd.fadeOut(400), 2000);
    }
}

// FLUSH A PENDING PROFILE SAVE BEFORE THE CHAT SWITCHES (regression H8).
// CHAT_CHANGED fires AFTER SillyTavern has repointed chat_metadata and context.chatId
// at the NEW chat, so a full saveProfileToMemory() here would write the old profile
// under the new chat's key and copy the old chat's memory blocks into the new chat's
// metadata. Only the settings half is flushed, and only under the key the live
// profile was actually loaded from.
export function flushProfileSettingsToLoadedKey() {
    // Only flush a save the user actually triggered. Without this, every chat switch
    // would write a chat-level profile for a chat that was merely inheriting the
    // character-level one, and that inheritance would be gone for good.
    if (!_profileSavePending) return;
    if (!_loadedProfileKey) return;
    if (!localProfile || !extension_settings[extensionName]?.profiles) return;

    const ruleBox = $("#ps_main_current_rule");
    if (ruleBox.length > 0) { localProfile.aiRule = ruleBox.val(); }

    // The same reset the full save does. The archived-set cache is a Set, which
    // JSON.stringify turns into `{}`; every stored profile holds null there, so
    // writing `{}` would be a shape nothing else produces and the archived-message
    // dimming would read it back as an empty cache instead of "not built yet".
    if (localProfile?.memoryCore) {
        localProfile.memoryCore._archivedSet = null;
    }

    const profileToSave = JSON.parse(JSON.stringify(localProfile));
    if (profileToSave.memoryCore) {
        delete profileToSave.memoryCore.shortTermChunks;
        delete profileToSave.memoryCore.longTermVault;
    }
    }
    if (profileToSave.imageGen) {
        delete profileToSave.imageGen.characterTags; // DO NOT save characterTags in settings.json!
    }

    meguminSparsifyProfilePrompts(profileToSave);

    extension_settings[extensionName].profiles[_loadedProfileKey] = profileToSave;
    saveSettingsDebounced();
    _profileSavePending = false;
}

// Split in two so the ~30 call sites stay as they are while the flush gets a dirty
// flag. cancelDebounce() has to be handed the INNER function: that is the one
// debounce() returned and registered in its map, and the wrapper is unknown to it.
export const _saveProfileDebouncedInner = debounce(saveProfileToMemory, 500);
export const saveProfileDebounced = () => { _profileSavePending = true; _saveProfileDebouncedInner(); };
