const getActorToken = (actor) => {
  const active = actor?.getActiveTokens?.(true, true) ?? [];
  return active[0] ?? canvas.tokens?.controlled?.[0] ?? null;
};

const _animationLocks = new Set();
const _animationLastRun = new Map();
const ANIMATION_COOLDOWN_MS = 250;

function animationsEnabled() {
  if (!game.modules.get("autoanimations")?.active) return false;
  const ns = game.system?.id;
  if (!ns) return true;
  try {
    return game.settings.get(ns, "enableAutomatedAnimations") !== false;
  } catch (_) {
    return true;
  }
}

function animationKey(actor, item) {
  const actorId = String(actor?.id ?? item?.actor?.id ?? "").trim();
  const itemId = String(item?.id ?? "").trim();
  if (!actorId && !itemId) return null;
  return `${actorId}:${itemId}`;
}

export const playAutomatedAnimation = async ({
  actor,
  item,
  targets,
} = {}) => {
  if (!item) return;
  if (!animationsEnabled()) return;

  const actorRef = actor ?? item.actor;
  const key = animationKey(actorRef, item);
  if (key) {
    if (_animationLocks.has(key)) return;
    const last = _animationLastRun.get(key) ?? 0;
    if (Date.now() - last < ANIMATION_COOLDOWN_MS) return;
    _animationLocks.add(key);
    _animationLastRun.set(key, Date.now());
  }

  const token = getActorToken(actorRef);
  if (!token) {
    if (key) _animationLocks.delete(key);
    return;
  }

  const targetList = targets ?? Array.from(game.user?.targets ?? []);

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
  } finally {
    if (key) _animationLocks.delete(key);
  }
};
