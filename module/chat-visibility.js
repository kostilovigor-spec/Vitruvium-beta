function gmIds() {
  return (game?.users ?? []).filter((u) => u.isGM).map((u) => u.id);
}

export function currentChatRollMode() {
  const mode = String(game?.settings?.get?.("core", "rollMode") ?? "publicroll");
  if (
    mode === "publicroll" ||
    mode === "gmroll" ||
    mode === "blindroll" ||
    mode === "selfroll"
  ) {
    return mode;
  }
  return "publicroll";
}

export function chatVisibilityData({ gmOnly = false } = {}) {
  if (gmOnly) return { whisper: gmIds() };
  const mode = currentChatRollMode();
  if (mode === "gmroll") return { whisper: gmIds() };
  if (mode === "blindroll") return { whisper: gmIds(), blind: true };
  if (mode === "selfroll" && game?.user?.id) return { whisper: [game.user.id] };
  return {};
}

