// ────────────────────────────────────────────────────────────────────────────
// NPC portrait generation — stub.
//
// ponytail: image generation has been cut out of this build, so the portrait
// pipeline (AI prompt → ComfyUI render) is gone with it. The NPC Bank tab keeps
// the button and shows why nothing happens. Bring the image feature back and
// restore this file from git history (`git log -- src/features/npc/pfp.js`).
// ────────────────────────────────────────────────────────────────────────────

export async function npcGeneratePfp() {
    toastr.warning("Portrait generation is not available in this build — image generation has been removed.", "NPC Bank");
    return null;
}
