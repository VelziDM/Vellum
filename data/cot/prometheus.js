// ─────────────────────────────────────────────────────────────────────────────
// PROMETHEUS — the chains of thought.
//
// Four variants, offered side by side in the Thinking picker so they can be
// compared on the same chat. The first is the default; the pairing in
// data/cot/index.js points at it.
//
//   cot-prometheus        writer's prose — the Ukiyo line, shortened
//   cot-prometheus-phases three unnamed beats: notice, decide, check
//   cot-prometheus-min    the shortest thing that still names the job
//   cot-prometheus-check  the prose line plus an explicit final check
//
// What is deliberately absent from all four: named specialists, PHASE 1..5,
// visible drafts, and a re-audit loop. R2-Write measures little gain from long
// reasoning on open writing; Anthropic asks for general instructions over
// hand-written steps; Psy-CoT says structured reasoning does help role-play.
// These four sit between those three claims.
//
// A -cap- variant is written from whichever one wins, not before.
// ─────────────────────────────────────────────────────────────────────────────

export const cot_prometheus = [
    {
      id: "cot-prometheus-english", trigger: "[[COT]]",
      label: "Prose",
      desc: "The writer's pass: intent, room, knowledge, temperature.",
      content: `Before you write, think like a writer, not a manager. This is a scene to tell, not a task to complete.

What did the reader just do? Not the words — the move. What did they lean into, what did they skip? The wish is the event they want; the want is the kind of scene they want to be in. Give them the want, and let the world decide whether the wish survives contact with it.

Who is in the room, and what does each of them want in this minute that has nothing to do with the reader? What are they carrying from before? For every line you are about to give them: how do they know it?

The reader is not the camera. Never go inside their head — their body is in the room, their mind is not.

What temperature is this scene asking for? Name it and commit. Do not repeat last turn's temperature or its opening. Hear every line in the mouth before you write it. The world proves itself in the specific: not "a bar," the bar.

End where the story is still moving. Never a question back to the reader, never a menu.`
    },
    {
      id: "cot-prometheus-phases-english", trigger: "[[COT]]",
      label: "Phases",
      desc: "Three beats — notice, decide, check — in prose.",
      content: `Before you write, run the scene once in your head.

Notice: what the reader just did, who is in the room, what each of them wants in this minute, and what each of them actually knows.

Decide: what changes this turn — a want, a fact, a secret, a consequence — where the scene's temperature sits, and which line opens it.

Check, before the turn leaves your hands: nobody acts on knowledge they do not have; nobody speaks for {{user}}; nothing repeats the last two turns; the turn ends on movement, not on a summary.

Think it in prose, not as a plan. These are the things to hold, not a form to fill.`
    },
    {
      id: "cot-prometheus-min-english", trigger: "[[COT]]",
      label: "Minimal",
      desc: "One paragraph naming the job. The shortest.",
      content: `Before you write, think the scene through in prose: who is here, what each of them wants in this beat, what the reader gets that is new, and where the turn ends. Do not write a plan.`
    },
    {
      id: "cot-prometheus-check-english", trigger: "[[COT]]",
      label: "Prose + check",
      desc: "The writer's pass, plus one final check before writing.",
      content: `Before you write, think like a writer, not a manager. This is a scene to tell, not a task to complete.

What did the reader just do? Not the words — the move. What did they lean into, what did they skip? The wish is the event they want; the want is the kind of scene they want to be in. Give them the want, and let the world decide whether the wish survives contact with it.

Who is in the room, and what does each of them want in this minute that has nothing to do with the reader? What are they carrying from before? For every line you are about to give them: how do they know it?

The reader is not the camera. Never go inside their head — their body is in the room, their mind is not.

What temperature is this scene asking for? Name it and commit. Do not repeat last turn's temperature or its opening. Hear every line in the mouth before you write it. The world proves itself in the specific: not "a bar," the bar.

End where the story is still moving. Never a question back to the reader, never a menu.

Before the turn leaves your hands, check it once: nobody acts on knowledge they do not have; nobody speaks for {{user}}; nothing repeats the last two turns; the turn ends on movement. Fix what fails and move on. Do not re-audit.`
    }
];
