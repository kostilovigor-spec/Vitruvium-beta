const hasOwn = (obj, key) =>
  Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const toRounds = (value, fallback = 0) => {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.round(safe));
};

const isPrimaryGM = () => {
  if (!game.user?.isGM) return false;
  const activeGm = game.users?.activeGM;
  if (!activeGm) return true;
  return activeGm.id === game.user.id;
};

const observedCombatRounds = new Map();

/**
 * Creates an ActiveEffect on the actor representing the state icon.
 * @param {Item} item - The state item document.
 */
async function createStateEffect(item) {
  if (!item.actor) return;
  const duration = toRounds(item.system?.durationRounds, 0);
  await item.actor.createEmbeddedDocuments("ActiveEffect", [
    {
      name: item.name,
      label: item.name,
      icon: item.img || "icons/svg/aura.svg",
      origin: item.uuid,
      duration: {
        rounds: duration,
      },
      changes: [],
      disabled: false,
    },
  ]);
}

/**
 * Deletes any ActiveEffects on the actor that originated from this item.
 * @param {Item} item - The state item document.
 */
async function deleteStateEffects(item) {
  if (!item.actor) return;
  const effectsToRemove =
    item.actor.effects?.filter((ef) => ef.origin && ef.origin.includes(item.uuid)) || [];
  if (effectsToRemove.length > 0) {
    await item.actor.deleteEmbeddedDocuments(
      "ActiveEffect",
      effectsToRemove.map((ef) => ef.id),
    );
  }
}

const normalizeStateSource = (itemDoc, change = {}) => {
  if (itemDoc?.type !== "state") return;
  if (!change || typeof change !== "object") return;

  const hasFlatActive = hasOwn(change, "system.active");
  const hasFlatDuration = hasOwn(change, "system.durationRounds");
  const hasFlatRemaining = hasOwn(change, "system.durationRemaining");

  if (hasFlatActive || hasFlatDuration || hasFlatRemaining) {
    change.system = change.system ?? {};
    if (hasFlatActive) {
      change.system.active = change["system.active"];
      delete change["system.active"];
    }
    if (hasFlatDuration) {
      change.system.durationRounds = change["system.durationRounds"];
      delete change["system.durationRounds"];
    }
    if (hasFlatRemaining) {
      change.system.durationRemaining = change["system.durationRemaining"];
      delete change["system.durationRemaining"];
    }
  }

  if (!change.system || typeof change.system !== "object") return;
  const next = change.system;

  const currentActive = itemDoc.system?.active !== false;
  const currentDuration = toRounds(itemDoc.system?.durationRounds, 0);
  const currentRemaining = toRounds(
    itemDoc.system?.durationRemaining,
    currentActive ? currentDuration : 0,
  );

  const hasActive = hasOwn(next, "active");
  const hasDuration = hasOwn(next, "durationRounds");
  const hasRemaining = hasOwn(next, "durationRemaining");

  const nextActive = hasActive ? next.active !== false : currentActive;
  const nextDuration = hasDuration
    ? toRounds(next.durationRounds, currentDuration)
    : currentDuration;
  const activeChanged = hasActive && nextActive !== currentActive;
  const durationChanged = hasDuration && nextDuration !== currentDuration;

  if (hasActive) next.active = nextActive;
  if (hasDuration) next.durationRounds = nextDuration;

  if (activeChanged) {
    next.durationRemaining = nextActive ? nextDuration : 0;
    return;
  }

  if (durationChanged) {
    next.durationRemaining = nextActive ? nextDuration : 0;
    return;
  }

  if (hasRemaining) {
    next.durationRemaining = toRounds(next.durationRemaining, currentRemaining);
  }
};

const applyRoundTickToCombat = async (combat, ticks) => {
  if (!combat || ticks <= 0) return;

  const actors = new Map();
  for (const combatant of combat.combatants ?? []) {
    const actor = combatant?.actor;
    if (!actor?.id) continue;
    if (!actors.has(actor.id)) actors.set(actor.id, actor);
  }

  const jobs = [];
  for (const actor of actors.values()) {
    const updates = [];
    for (const item of actor.items ?? []) {
      if (item.type !== "state") continue;
      if (item.system?.active === false) continue;

      const durationRounds = toRounds(item.system?.durationRounds, 0);
      if (durationRounds <= 0) continue;

      const startRemaining = toRounds(
        item.system?.durationRemaining,
        durationRounds,
      );
      const nextRemaining = Math.max(0, startRemaining - ticks);
      const patch = {
        _id: item.id,
        "system.durationRemaining": nextRemaining,
      };
      if (nextRemaining <= 0) patch["system.active"] = false;
      updates.push(patch);
    }
    if (updates.length) {
      jobs.push(actor.updateEmbeddedDocuments("Item", updates));
    }
  }

  if (jobs.length) await Promise.allSettled(jobs);
};

let stateDurationHooksRegistered = false;

export const registerStateDurationHooks = () => {
  if (stateDurationHooksRegistered) return;
  stateDurationHooksRegistered = true;

  Hooks.on("preCreateItem", (itemDoc, data) => {
    if (itemDoc?.type !== "state") return;
    const incoming = data?.system ?? {};
    const sourcePatch = {};

    const active =
      typeof incoming.active === "boolean" ? incoming.active : true;
    const durationRounds = toRounds(incoming.durationRounds, 0);
    const durationRemaining = active ? durationRounds : 0;

    if (typeof incoming.active !== "boolean") {
      sourcePatch["system.active"] = active;
    }
    if (!hasOwn(incoming, "durationRounds")) {
      sourcePatch["system.durationRounds"] = durationRounds;
    }
    if (!hasOwn(incoming, "durationRemaining")) {
      sourcePatch["system.durationRemaining"] = durationRemaining;
    }

    if (Object.keys(sourcePatch).length) itemDoc.updateSource(sourcePatch);
  });

  Hooks.on("preUpdateItem", (itemDoc, change) => {
    normalizeStateSource(itemDoc, change);
  });

  Hooks.on("createItem", async (item, options, userId) => {
    if (game.user.id !== userId) return;
    if (item.type !== "state") return;
    const isActive = item.system?.active !== false;
    const durationRemaining = toRounds(item.system?.durationRemaining, 0);
    if (isActive && durationRemaining > 0) {
      await createStateEffect(item);
    }
  });

  Hooks.on("updateItem", async (item, change, options, userId) => {
    if (game.user.id !== userId) return;
    if (item.type !== "state") return;

    const hasActiveChanged =
      hasOwn(change, "system.active") || hasOwn(change?.system ?? {}, "active");
    const hasDurationRemainingChanged =
      hasOwn(change, "system.durationRemaining") ||
      hasOwn(change?.system ?? {}, "durationRemaining");
    const hasImgChanged = hasOwn(change, "img");
    const hasNameChanged = hasOwn(change, "name");

    const isActive = item.system?.active !== false;
    const durationRemaining = toRounds(item.system?.durationRemaining, 0);

    // If active status changed or duration expired, sync the icon.
    if (
      hasActiveChanged ||
      (hasDurationRemainingChanged && durationRemaining <= 0)
    ) {
      if (isActive && durationRemaining > 0) {
        // Only create if it doesn't already exist (idempotency)
        const exists = item.actor?.effects?.some(
          (ef) => ef.origin && ef.origin.includes(item.uuid),
        );
        if (!exists) await createStateEffect(item);
      } else {
        await deleteStateEffects(item);
      }
    } else if (isActive && (hasImgChanged || hasNameChanged)) {
      // Sync icon graphics or label if it changed while active.
      const effect = item.actor?.effects?.find(
        (ef) => ef.origin && ef.origin.includes(item.uuid),
      );
      if (effect) {
        await effect.update({
          name: item.name,
          label: item.name,
          icon: item.img,
        });
      }
    }
  });

  Hooks.on("deleteItem", async (item, options, userId) => {
    if (game.user.id !== userId) return;
    if (item.type !== "state") return;
    await deleteStateEffects(item);
  });

  Hooks.once("ready", () => {
    for (const combat of game.combats ?? []) {
      observedCombatRounds.set(combat.id, toRounds(combat.round, 0));
    }
  });

  Hooks.on("createCombat", (combat) => {
    observedCombatRounds.set(combat.id, toRounds(combat.round, 0));
  });

  Hooks.on("deleteCombat", (combat) => {
    observedCombatRounds.delete(combat.id);
  });

  Hooks.on("updateCombat", async (combat, change) => {
    if (!isPrimaryGM()) return;
    if (!hasOwn(change, "round")) return;

    const newRound = toRounds(combat.round ?? change.round, 0);
    const prevRound = observedCombatRounds.get(combat.id);
    observedCombatRounds.set(combat.id, newRound);

    if (!Number.isFinite(prevRound)) return;
    if (newRound <= prevRound) return;

    // Start ticking from round 2 so round 1 does not immediately consume duration.
    const baseline = Math.max(prevRound, 1);
    const ticks = Math.max(0, newRound - baseline);
    if (ticks <= 0) return;

    await applyRoundTickToCombat(combat, ticks);
  });
};
