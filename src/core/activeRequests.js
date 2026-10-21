// ─────────────────────────────────────────────────────────────────────────────
// In-flight background request markers.
//
// These are the handshake between the features and the prompt engine. A feature
// that wants the engine to build a DIFFERENT prompt than the normal roleplay one
// parks its payload here, fires a quiet generation, and clears it in a finally.
// handlePromptInjection() reads them to decide which prompt shape to emit.
//
// They live together, apart from state.js, because they share one lifecycle and
// one meaning: "a non-roleplay generation is currently running, and here is what
// it needs." Scattering them back into their feature modules would leave the
// engine importing from six features just to answer that question.
//
// Reads elsewhere work through live bindings; reassignment goes through the
// setters. See the long note in state.js for why.
// ─────────────────────────────────────────────────────────────────────────────

// Memory Core: the chunk text being summarised.
export let activeMemorySummarizationRequest = null;
export function setActiveMemorySummarizationRequest(v) { activeMemorySummarizationRequest = v; }

