// ────────────────────────────────────────────────────────────────────────────
// The settings window's tab list and its dock.
//
// This is the one module that knows which renderer draws which tab, so it must
// import all of them. The renderers therefore must not import back: a tab that
// needs to redraw itself fires REFRESH.SWITCH_TAB instead, which is registered
// at the bottom of this file.
// ────────────────────────────────────────────────────────────────────────────

import { localProfile, currentTab, setCurrentTab } from "../core/state.js";
import { registerRefreshHook, REFRESH } from "../core/refreshHooks.js";
import { saveSettingsDebounced } from "../st.js";
import { updateLiveTokenCount } from "../core/tokens.js";
import { renderCoreAndCot } from "./tabs/coreAndCot.js";
import { renderGlobalSettings } from "./tabs/globalSettings.js";
import { renderMemoryCore } from "../features/memory/index.js";
import { renderChomusuke } from "./tabs/chomusuke.js";

// Dock order is array order. `group` puts a tab inside a folding group of the
// dock; `bottom` pins it under the spacer; `shown()` hides it while it has
// nothing to do. Find a tab by `id` (tabIndex), never by title or position:
// titles are what the user reads and positions move when the dock is reordered.
export const tabsUI = [
    { id: "preset", title: "Preset & Thinking", sub: "Choose the preset, how it thinks, and the story's standing rules.", icon: "fa-server", render: renderCoreAndCot },
    { id: "chomusuke", title: "Chomusuke", sub: "Your helper model: it does background work so the story model doesn't have to.", icon: "fa-cat", render: renderChomusuke },
    { id: "memory", group: "tools", title: "Memory", sub: "How the story remembers older parts of the chat.", icon: "fa-memory", render: renderMemoryCore },
    { id: "settings", bottom: true, title: "Settings", sub: "Extension preferences and about info.", icon: "fa-gear", render: renderGlobalSettings }
];

export const DOCK_GROUPS = [
    { id: "tools", title: "More Tools", icon: "fa-toolbox" }
];

export function tabIndex(id) {
    return tabsUI.findIndex(t => t.id === id);
}

// Which groups are open. Not saved: the group of the tab you open is opened for
// you, so there is nothing to lose between sessions.
const openGroups = new Set();

function dockDot(t, i) {
    return `<div class="dock-icon sidebar-step" id="dot_${i}" data-tab-id="${t.id}" title="${t.title}">
        <i class="fa-solid ${t.icon}"></i> <span>${t.title}</span>
    </div>`;
}

function buildDock(dotsContainer) {
    dotsContainer.empty();

    tabsUI.forEach((t, i) => { if (!t.group && !t.bottom) dotsContainer.append(dockDot(t, i)); });

    DOCK_GROUPS.forEach(g => {
        dotsContainer.append(`<div class="dock-icon dock-group-head" data-group="${g.id}" title="${g.title}">
            <i class="fa-solid ${g.icon}"></i> <span>${g.title}<em class="dock-group-current"></em></span>
            <i class="fa-solid fa-chevron-right dock-group-chevron"></i>
        </div>`);
        const items = $(`<div class="dock-group-items" data-group="${g.id}"></div>`);
        tabsUI.forEach((t, i) => { if (t.group === g.id) items.append(dockDot(t, i)); });
        dotsContainer.append(items);
    });

    // Push Settings to the bottom of the dock
    dotsContainer.append(`<div style="flex-grow: 1;"></div>`);
    tabsUI.forEach((t, i) => {
        if (t.bottom) dotsContainer.append($(dockDot(t, i)).css({ "margin-bottom": "15px", color: "#a1a1aa", transition: "0.2s" }));
    });

    dotsContainer.attr("data-built", "1");
    dotsContainer.off("click.dockGroup").on("click.dockGroup", ".dock-group-head", function (e) {
        const id = $(this).attr("data-group");
        // The phone bar has no room to unfold a group: its tabs open in a
        // small sheet above the bar instead.
        if (isPhoneDock()) { e.stopPropagation(); togglePhoneSheet(id, this); return; }
        if (openGroups.has(id)) openGroups.delete(id); else openGroups.add(id);
        refreshDockGroups();
    });
}

// The dock is a bottom bar at this width (style.css, "DOCK → floating bottom bar").
const isPhoneDock = () => window.matchMedia && window.matchMedia("(max-width: 768px)").matches;

function closePhoneSheet() {
    $("#ps_dock_sheet").remove();
    $(document).off("click.dockSheet");
}

function togglePhoneSheet(groupId, head) {
    const open = $("#ps_dock_sheet");
    if (open.length) {
        const same = open.attr("data-group") === groupId;
        closePhoneSheet();
        if (same) return;
    }
    const modal = $(head).closest(".ps-modern-modal");
    const host = modal.length ? modal : $("body");
    const g = DOCK_GROUPS.find(x => x.id === groupId);
    const $sheet = $(`<div id="ps_dock_sheet" class="dock-sheet" data-group="${groupId}">
        <div class="dock-sheet-title"><i class="fa-solid ${g ? g.icon : "fa-folder"}"></i> ${g ? g.title : ""}</div>
    </div>`);
    tabsUI.forEach((t, i) => {
        if (t.group !== groupId) return;
        if (typeof t.shown === "function" && !t.shown()) return;
        const $b = $(`<button type="button" class="dock-sheet-item ${i === currentTab ? "active" : ""}"><i class="fa-solid ${t.icon}"></i> ${t.title}</button>`);
        $b.on("click", () => { closePhoneSheet(); switchTab(i); });
        $sheet.append($b);
    });
    host.append($sheet);

    // Over the pill that opened it, kept inside the window.
    const hostRect = host[0].getBoundingClientRect();
    const headRect = head.getBoundingClientRect();
    const width = $sheet.outerWidth();
    let left = headRect.left - hostRect.left;
    left = Math.max(10, Math.min(left, hostRect.width - width - 10));
    $sheet.css({ left: `${left}px`, bottom: `${Math.max(70, hostRect.bottom - headRect.top + 8)}px` });

    // Closes on any tap outside it (the next tap, not this one).
    setTimeout(() => {
        $(document).on("click.dockSheet", ev => {
            if (!$(ev.target).closest("#ps_dock_sheet").length) closePhoneSheet();
        });
    }, 0);
}

// Open/closed state, the highlight on a closed group that holds the open tab,
// and the tabs that are hidden right now.
function refreshDockGroups() {
    const dotsContainer = $("#ps_dynamic_dots");
    tabsUI.forEach((t, i) => {
        $(`#dot_${i}`).toggleClass("dock-hidden", typeof t.shown === "function" && !t.shown());
    });
    const activeTab = tabsUI[currentTab] || {};
    const activeGroup = activeTab.group;
    DOCK_GROUPS.forEach(g => {
        const open = openGroups.has(g.id);
        const $head = dotsContainer.find(`.dock-group-head[data-group="${g.id}"]`);
        $head.toggleClass("open", open)
            .toggleClass("has-active", !open && activeGroup === g.id)
            // The phone bar never unfolds, so it always marks the group you are in
            // and names the tab: "More Tools · Memory".
            .toggleClass("has-tab", activeGroup === g.id);
        $head.find(".dock-group-current").text(activeGroup === g.id ? ` · ${activeTab.title}` : "");
        dotsContainer.find(`.dock-group-items[data-group="${g.id}"]`).toggleClass("open", open);
    });
}

export function switchTab(index) {
    $(".dock").show();
    $("#ps_btn_save_close").show();
    // The toggle is per tab, so its label has to follow the tab.


    let isSameTab = (currentTab === index);
    const container = $("#ps_stage_content");
    let savedScroll = 0;
    if (isSameTab && container.length) {
        savedScroll = container.scrollTop() || 0;
    }

    setCurrentTab(index);
    const tab = tabsUI[index];
    closePhoneSheet();

    // Generate Icons
    const dotsContainer = $("#ps_dynamic_dots");
    if (dotsContainer.attr("data-built") !== "1" || !dotsContainer.children(".sidebar-step").length) {
        buildDock(dotsContainer);
    }

    // Going to a tab opens its group, so you can see where you are.
    if (tab && tab.group && !isSameTab) openGroups.add(tab.group);

    $(".dock-icon").removeClass("active");
    $(`#dot_${index}`).addClass("active");
    refreshDockGroups();

    // Re-read every switch rather than only at build time: the dots are drawn once
    // and reused, so a notice spent this session has to be able to go out again.

    container.empty();
    container.off(".devDirty");

    tab.render(container);

    if (isSameTab) {
        container.scrollTop(savedScroll);
    } else {
        container.scrollTop(0);
    }

    updateLiveTokenCount();
}

// ────────────────────────────────────────────────────────────────────────────
// Wiring.
// ────────────────────────────────────────────────────────────────────────────

// With no index: redraw whatever is on screen. With one (a number, or a tab id
// like "memory"): navigate to it.
registerRefreshHook(REFRESH.SWITCH_TAB, (index) => {
    const i = typeof index === "string" ? tabIndex(index) : index;
    switchTab(typeof i === "number" && i >= 0 ? i : currentTab);
});
