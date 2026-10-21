// ─────────────────────────────────────────────────────────────────────────────
// PROMETHEUS — the chain of thought.
//
// The reasoning script the model works through before it writes the turn. It is
// the counterpart of the engine's own text: same rules, same voice, and it has
// to agree with them line for line.
//
// Empty on purpose, like the engine. The slot is wired and the wrapper is
// ready; there is nothing to reason over until the engine has a voice.
// ─────────────────────────────────────────────────────────────────────────────

export const cot_prometheus = [
    {
        id: "cot-prometheus-english", trigger: "[[COT]]",
        content: ""
    }
];
