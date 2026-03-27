function gmIds({ activeOnly = false } = {}) {
  return (game?.users ?? [])
    .filter((u) => u.isGM && (!activeOnly || u.active))
    .map((u) => u.id);
}

function uniqueIds(ids = []) {
  const out = [];
  for (const id of ids) {
    const v = String(id ?? "").trim();
    if (!v || out.includes(v)) continue;
    out.push(v);
  }
  return out;
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
  const onlineGmIds = gmIds({ activeOnly: true });
  const allGmIds = gmIds();
  const gmRecipients = onlineGmIds.length ? onlineGmIds : allGmIds;

  if (gmOnly) return { whisper: gmRecipients };

  const mode = currentChatRollMode();
  if (mode === "gmroll") {
    const recipients = uniqueIds([...gmRecipients, game?.user?.id]);
    return recipients.length ? { whisper: recipients } : {};
  }
  if (mode === "blindroll") return { whisper: gmRecipients, blind: true };
  if (mode === "selfroll" && game?.user?.id) return { whisper: [game.user.id] };
  return {};
}
