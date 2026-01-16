const getActorToken = (actor) => {
  const active = actor?.getActiveTokens?.(true, true) ?? [];
  return active[0] ?? canvas.tokens?.controlled?.[0] ?? null;
};

export const playAutomatedAnimation = async ({
  actor,
  item,
  targets,
} = {}) => {
  if (!item) return;
  if (!game.modules.get("autoanimations")?.active) return;

  const token = getActorToken(actor ?? item.actor);
  if (!token) return;

  const targetList =
    targets ?? Array.from(game.user?.targets ?? []);

  try {
    if (window.AutomatedAnimations?.playAnimation) {
      return await window.AutomatedAnimations.playAnimation(
        token,
        item,
        { targets: targetList }
      );
    }
    if (window.AutoAnimations?.playAnimation) {
      const list = Array.isArray(targetList)
        ? targetList
        : Array.from(targetList ?? []);
      return await window.AutoAnimations.playAnimation(
        token,
        list,
        item,
        {}
      );
    }
  } catch (err) {
    console.warn("Vitruvium | Automated Animations failed", err);
  }
};
