// ─────────────────────────────────────────────────────────────────────────────
// PROMETHEUS — the chains of thought.
//
// Two survivors, offered side by side in the Thinking picker, plus one
// experimental variant under test:
//
//   cot-prometheus-phases-english        three beats: notice, decide, check
//   cot-prometheus-phases-check-english  the same beats, tightened with an
//                                        agency and no-repeat check (A/B)
//   cot-prometheus-check-english         the prose line plus an explicit final check
//
// Prose and Minimal lost their run on 2026-10-23 and were removed. Their
// transcripts stay under test-runs/; the reasoning is in docs/testing.
//
// What is deliberately absent: named specialists, PHASE 1..5, visible drafts,
// and a re-audit loop.
// ─────────────────────────────────────────────────────────────────────────────

export const cot_prometheus = [
    {
      id: "cot-prometheus-phases-english", trigger: "[[COT]]",
      label: "Phases",
      desc: "Three beats — notice, decide, check — in prose.",
      content: `Before you write, run the scene once in your head.

Notice: what {{user}} just did, who is in the room, what each of them wants in this minute, and what each of them actually knows.

Decide: what changes this turn — a want, a fact, a secret, a consequence — where the scene's temperature sits, and which line opens it.

Check, before the turn leaves your hands: nobody acts on knowledge they do not have; nobody speaks for {{user}}; nothing repeats the last two turns; the turn ends on movement, not on a summary.

Think it in prose, not as a plan. These are the things to hold, not a form to fill.`
    },
    {
      id: "cot-prometheus-phases-check-english", trigger: "[[COT]]",
      label: "Phases + check",
      desc: "The three beats, plus an explicit agency and no-repeat check.",
      content: `Before you write, run the scene once in your head.

Notice: what {{user}} just did, who is in the room, what each of them wants in this minute, and what each of them actually knows.

Decide: what changes this turn — a want, a fact, a secret, a consequence — where the scene's temperature sits, and which line opens it. Every NPC in the room acts on their own want this beat: something aimed at {{user}} or at the surroundings — a refusal, a demand, a touch, a threat, a hand on an object — never an idle wait and never a vague walk-out.

Check, before the turn leaves your hands: nobody acts on knowledge they do not have; nobody speaks for {{user}}; nothing repeats the last two turns; you did not re-narrate what {{user}} already wrote — say only what is new; the turn ends on movement, not on a summary.

Hold three things the whole time: {{user}}'s persona is yours, not the room's — no NPC knows their name, rank, or past unless told or shown, and no guess is spoken as fact; information is an asset — no NPC names the target, location, or coordinates until they choose to, and a demand is not a reason to hand them over; and the page already fixes the clock and the words — keep time and facts consistent, and never re-quote a line or gesture from an earlier turn.

Think it in prose, not as a plan. These are the things to hold, not a form to fill.`
    },
    {
      id: "cot-prometheus-check-english", trigger: "[[COT]]",
      label: "Prose + check",
      desc: "The writer's pass, plus one final check before writing.",
      content: `Before you write, think like a writer, not a manager. This is a scene to tell, not a task to complete.

What did {{user}} just do? Not the words — the move. What did they lean into, what did they skip? The wish is the event they want; the want is the kind of scene they want to be in. Give {{user}} the want, and let the world decide whether the wish survives contact with it.

Who is in the room, and what does each of them want in this minute that has nothing to do with {{user}}? What are they carrying from before? For every line you are about to give them: how do they know it?

{{user}} is not the camera. Never go inside their head — their body is in the room, their mind is not.

What temperature is this scene asking for? Name it and commit. Do not repeat last turn's temperature or its opening. Hear every line in the mouth before you write it. The world proves itself in the specific: not "a bar," the bar.

End where the story is still moving. Never a question back to {{user}}, never a menu.

Before the turn leaves your hands, check it once: nobody acts on knowledge they do not have; nobody speaks for {{user}}; nothing repeats the last two turns; the turn ends on movement. Fix what fails and move on. Do not re-audit.`
    }
];
