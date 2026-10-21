// ─────────────────────────────────────────────────────────────────────────────
// Which engines there are, and what that means.
//
// The generation tests (isV7, isV9, isModern and the rest) went with the
// generations themselves: there is one engine now, and a predicate that asks
// "is this V9?" has nothing to ask about.
//
// One predicate survived. The Co-writer variants — engines written to author
// {{user}} as well as the world — are gone with their generation, but a reader
// who cloned one may still have it in their profile, and that clone is still a
// Co-writer. The rule that keeps the model from writing {{user}} for the
// reader has to know the difference, so the flag is still read.
//
// A screen that wants to know what to CALL the engine reads `engine.label`; it
// never reconstructs the name from a flag.
// ─────────────────────────────────────────────────────────────────────────────

// The Co-writer variants, which author {{user}} as well as the world. Flag first
// so a clone of one keeps answering true, id suffix second so an engine built
// before the flag existed still reads correctly.
export const isCoWriterEngine = m => !!m && (m.isCoWriter === true || String(m.id || "").endsWith("-cw"));
