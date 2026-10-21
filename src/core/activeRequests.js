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

// World State side-model extraction: { system, user, prefill } built by
// renderWorldExtractPrompt. Set only for the length of one quiet generation.
export let activeWorldExtractRequest = null;
export function setActiveWorldExtractRequest(v) { activeWorldExtractRequest = v; }

// Memory Core: the chunk text being summarised.
export let activeMemorySummarizationRequest = null;
export function setActiveMemorySummarizationRequest(v) { activeMemorySummarizationRequest = v; }

// Manual "run this order" task: substituted into [[order]] placeholders.
export let activeGenerationOrder = null;
export function setActiveGenerationOrder(v) { activeGenerationOrder = v; }

// ── Is any non-roleplay generation running? ──────────────────────────────────
// Used by the engine to suppress the prompt-preview popup during background work.
export function isBackgroundGenerationActive() {
    return !!(
        activeMemorySummarizationRequest ||
        activeWorldExtractRequest ||
        activeGenerationOrder
    );
}
