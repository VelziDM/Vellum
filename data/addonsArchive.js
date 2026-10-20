// ─────────────────────────────────────────────────────────────────────────────
// Archived add-on prompt modules.
//
// These three were removed from the UI with the Language & Add-ons tab. Their
// prompt text is preserved verbatim so the final preset cut can hardwire them
// in as always-on engine rules if wanted. Not imported anywhere.
//
// To use: paste the `content` string into the engine text (or preset JSON) at
// the position authority wants, then delete this file.
// ─────────────────────────────────────────────────────────────────────────────

export const archivedAddons = [
    { id: "combat", label: "Combat System", trigger: "[[combat]]", content: "[COMBAT SYSTEM]\nNo Plot Armor: Combat follows physical reality. Size, skill, numbers, weapons, and preparation matter. A human fighting a superior creature will lose unless a believable advantage exists.\nTurn Structure: Combat unfolds turn-by-turn. Each action has clear cause, cost, and consequence. No skipped steps.\nWeight & Risk: Every strike, miss, wound, and hesitation carries impact. Injury, fatigue, fear, and pain affect future actions.\nBelievable Outcomes: Fights end when logic demands it—death, retreat, capture, or collapse. Victory must be earned; survival must be justified." },
    { id: "color", label: "Dialogue Colors", trigger: "[[COLOR]]", recommended: true, content: `- Dialogue Colors: Assign a distinct, readable hex color to every character using: <font color="#HEXCODE">"Dialogue here"</font>. Once assigned, a character's color is LOCKED for the entire story.` },
    { id: "dn", label: "Dialogue & Narration Format", trigger: "[[DN]]", content: "- Narration must be between <narration>.........</narration>. and dialogue must be between <dialogue >.........</dialogue > and you can interwoven them throughout the response." }
];
