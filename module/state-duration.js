import { normalizeModifiers, applyEffect, removeEffect } from "./effects.js";

const hasOwn = (obj, key) =>
  Object.prototype.hasOwnProperty.call(obj ?? {}, key);

const toTurns = (value, fallback = 0) => {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.round(safe));
};

const FLAG_SCOPE = "mySystem";
const OVERTIME_TYPES = new Set(["dot", "hot"]);
const OVERTIME_TIMINGS = new Set(["start", "end"]);

const isPrimaryGM = () => {
  if (!game.user?.isGM) return false;
  const activeGm = game.users?.activeGM;
  if (!activeGm) return true;
  return activeGm.id === game.user.id;
};

const observedCombatTurns = new Map();

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const getCombatSnapshot = (combat) => {
  const combatant = combat?.combatant ?? null;
  return {
    turn: Number.isFinite(Number(combat?.turn)) ? Number(combat.turn) : null,
    round: Number.isFinite(Number(combat?.round)) ? Number(combat.round) : null,
    combatantId: String(combatant?.id ?? "").trim() || null,
    actorId: String(combatant?.actor?.id ?? "").trim() || null,
  };
};

const readTurnState = (item) => {
  const flags = item?.flags?.[FLAG_SCOPE] ?? {};
  const sys = item?.system ?? {};
  const active = sys.active !== false;

  const legacyDuration = toTurns(sys.durationRounds, 0);
  const legacyRemaining = toTurns(
    sys.durationRemaining,
    active ? legacyDuration : 0,
  );
  const turnDuration = toTurns(flags.turnDuration, legacyDuration);
  const hasFlagRemaining =
    flags.remainingTurns !== undefined &&
    flags.remainingTurns !== null &&
    `${flags.remainingTurns}`.trim() !== "";
  const remainingTurns = hasFlagRemaining
    ? toTurns(flags.remainingTurns, 0)
    : active
      ? legacyRemaining || turnDuration
      : 0;
  const ownerActorId = String(flags.ownerActorId ?? item?.actor?.id ?? "").trim();
  const appliedRound = Number.isFinite(Number(flags.appliedRound))
    ? Number(flags.appliedRound)
    : null;
  const appliedTurn = Number.isFinite(Number(flags.appliedTurn))
    ? Number(flags.appliedTurn)
    : null;
  const appliedActorId = String(flags.appliedActorId ?? "").trim();

  return {
    active,
    turnDuration,
    remainingTurns,
    ownerActorId,
    appliedRound,
    appliedTurn,
    appliedActorId,
  };
};

const extractPatchTurnState = (itemDoc, change = {}) => {
  if (itemDoc?.type !== "state") return null;
  if (!change || typeof change !== "object") return null;

  const hasFlatActive = hasOwn(change, "system.active");
  const hasFlatDuration = hasOwn(change, "system.durationRounds");
  const hasFlatRemaining = hasOwn(change, "system.durationRemaining");
  const hasFlatTurnDuration = hasOwn(change, `flags.${FLAG_SCOPE}.turnDuration`);
  const hasFlatRemainingTurns = hasOwn(
    change,
    `flags.${FLAG_SCOPE}.remainingTurns`,
  );
  const hasFlatOwnerActorId = hasOwn(
    change,
    `flags.${FLAG_SCOPE}.ownerActorId`,
  );

  if (
    hasFlatActive ||
    hasFlatDuration ||
    hasFlatRemaining ||
    hasFlatTurnDuration ||
    hasFlatRemainingTurns ||
    hasFlatOwnerActorId
  ) {
    change.system = change.system ?? {};
    change.flags = change.flags ?? {};
    change.flags[FLAG_SCOPE] = change.flags[FLAG_SCOPE] ?? {};

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
    if (hasFlatTurnDuration) {
      change.flags[FLAG_SCOPE].turnDuration =
        change[`flags.${FLAG_SCOPE}.turnDuration`];
      delete change[`flags.${FLAG_SCOPE}.turnDuration`];
    }
    if (hasFlatRemainingTurns) {
      change.flags[FLAG_SCOPE].remainingTurns =
        change[`flags.${FLAG_SCOPE}.remainingTurns`];
      delete change[`flags.${FLAG_SCOPE}.remainingTurns`];
    }
    if (hasFlatOwnerActorId) {
      change.flags[FLAG_SCOPE].ownerActorId =
        change[`flags.${FLAG_SCOPE}.ownerActorId`];
      delete change[`flags.${FLAG_SCOPE}.ownerActorId`];
    }
  }

  const nextSystem = change.system ?? {};
  const nextFlags = (change.flags ?? {})[FLAG_SCOPE] ?? {};
  const current = readTurnState(itemDoc);

  const hasActive = hasOwn(nextSystem, "active");
  const hasSystemDuration = hasOwn(nextSystem, "durationRounds");
  const hasSystemRemaining = hasOwn(nextSystem, "durationRemaining");
  const hasTurnDuration = hasOwn(nextFlags, "turnDuration");
  const hasRemainingTurns = hasOwn(nextFlags, "remainingTurns");
  const hasOwnerActorId = hasOwn(nextFlags, "ownerActorId");

  const active = hasActive ? nextSystem.active !== false : current.active;
  const turnDuration = hasTurnDuration
    ? toTurns(nextFlags.turnDuration, current.turnDuration)
    : hasSystemDuration
      ? toTurns(nextSystem.durationRounds, current.turnDuration)
      : current.turnDuration;

  let remainingTurns;
  if (hasRemainingTurns) {
    remainingTurns = toTurns(nextFlags.remainingTurns, current.remainingTurns);
  } else if (hasSystemRemaining) {
    remainingTurns = toTurns(nextSystem.durationRemaining, current.remainingTurns);
  } else if (hasActive && active !== current.active) {
    remainingTurns = active ? turnDuration : 0;
  } else if (hasTurnDuration || hasSystemDuration) {
    remainingTurns = active ? turnDuration : 0;
  } else {
    remainingTurns = current.remainingTurns;
  }

  const ownerActorId = String(
    hasOwnerActorId ? nextFlags.ownerActorId : current.ownerActorId,
  ).trim();

  return { active, turnDuration, remainingTurns, ownerActorId };
};

/**
 * Creates an ActiveEffect on the actor representing the state icon.
 * Duration is controlled by item flags and turn updates, not ActiveEffect rounds.
 * @param {Item} item - The state item document.
 */
async function createStateEffect(item) {
  if (!item.actor) return;
  const timing = readTurnState(item);
  const iconPath = item.img || "icons/svg/aura.svg";
  const statusId = `vitruvium-state-${item.id}`;
  await applyEffect(item.actor, {
    name: item.name,
    label: item.name,
    // Keep both keys for compatibility across Foundry versions/modules.
    icon: iconPath,
    img: iconPath,
    origin: item.uuid,
    // We do not use Foundry round ticking anymore, but keep a turn duration
    // so the effect is treated as temporary and shown on tokens.
    duration: {
      turns: Math.max(1, timing.remainingTurns || timing.turnDuration || 1),
    },
    statuses: [statusId],
    changes: [],
    disabled: false,
  });
}

/**
 * Deletes any ActiveEffects on the actor that originated from this item.
 * @param {Item} item - The state item document.
 */
async function deleteStateEffects(item) {
  if (!item.actor) return;
  await removeEffect(item.actor, item.uuid);
}

const collectOverTimeEntries = (stateItem, triggerTiming) => {
  if (!stateItem || stateItem.type !== "state") return [];
  if (stateItem.system?.active === false) return [];
  const effects = normalizeModifiers(stateItem.system?.modifiers, { keepZero: false });
  return effects.filter((eff) => {
    const type = String(eff?.target ?? "").trim();
    const timing = String(eff?.triggerTiming ?? "").trim();
    if (!OVERTIME_TYPES.has(type)) return false;
    if (!OVERTIME_TIMINGS.has(timing)) return false;
    if (timing !== triggerTiming) return false;
    const value = toNumber(eff?.value, 0);
    return Number.isFinite(value) && value > 0;
  });
};

const shouldExpireStateOnTurnStart = (stateItem) => {
  if (!stateItem || stateItem.type !== "state") return false;
  if (stateItem.system?.active === false) return false;
  return stateItem.flags?.[FLAG_SCOPE]?.expireOnTurnStart === true;
};

const expireStatesOnTurnStartForActor = async (actor) => {
  if (!actor?.id) return;
  const toDelete = [];
  for (const item of actor.items ?? []) {
    if (item.type !== "state") continue;
    if (shouldExpireStateOnTurnStart(item)) {
      toDelete.push(item.id);
    }
  }
  if (toDelete.length > 0) {
    await actor.deleteEmbeddedDocuments("Item", toDelete);
  }
};

import { ActionProcessor } from "./core/action-processor.js";

const applyOverTimeEffectsForActor = async (actor, triggerTiming) => {
  if (!actor?.id) return;
  if (!OVERTIME_TIMINGS.has(triggerTiming)) return;

  const processor = new ActionProcessor();
  let hotTotal = 0;

  for (const item of actor.items ?? []) {
    if (item.type !== "state") continue;
    const entries = collectOverTimeEntries(item, triggerTiming);
    if (!entries.length) continue;
    for (const eff of entries) {
      const value = Math.max(0, Math.round(Math.abs(toNumber(eff.value, 0))));
      if (!value) continue;

      if (eff.target === "dot") {
        await processor.process({
          type: "dot",
          actor,
          value
        });
      } else if (eff.target === "hot") {
        hotTotal += value;
      }
    }
  }

  // HoT: через ActionProcessor (единственное место изменения HP)
  if (hotTotal > 0) {
    await processor.process({
      type: "heal",
      actor,
      value: hotTotal
    });
  }
};

const tickActorOwnedStates = async (
  actor,
  ownerActorId,
  { endedRound = null, endedTurn = null } = {},
) => {
  if (!actor?.id || !ownerActorId) return;

  const updates = [];
  const toDelete = [];

  for (const item of actor.items ?? []) {
    if (item.type !== "state") continue;
    const timing = readTurnState(item);
    if (!timing.active) continue;
    if (timing.ownerActorId !== ownerActorId) continue;
    if (timing.turnDuration <= 0) continue;
    const skipFirstOwnerTurnTick =
      timing.appliedActorId === ownerActorId &&
      timing.appliedRound === endedRound &&
      timing.appliedTurn === endedTurn;
    if (skipFirstOwnerTurnTick) continue;

    const nextRemaining = Math.max(0, timing.remainingTurns - 1);
    if (nextRemaining <= 0) {
      toDelete.push(item.id);
      continue;
    }

    updates.push({
      _id: item.id,
      "flags.mySystem.remainingTurns": nextRemaining,
      "flags.mySystem.turnDuration": timing.turnDuration,
      "flags.mySystem.ownerActorId": timing.ownerActorId,
      "system.durationRounds": timing.turnDuration,
      "system.durationRemaining": nextRemaining,
      "system.active": true,
    });
  }

  if (updates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", updates);
  }
  if (toDelete.length > 0) {
    await actor.deleteEmbeddedDocuments("Item", toDelete);
  }
};

let stateDurationHooksRegistered = false;

export const registerStateDurationHooks = () => {
  if (stateDurationHooksRegistered) return;
  stateDurationHooksRegistered = true;

  Hooks.on("preCreateItem", (itemDoc, data) => {
    if (itemDoc?.type !== "state") return;
    const incomingSystem = data?.system ?? {};
    const incomingFlags = (data?.flags ?? {})[FLAG_SCOPE] ?? {};

    const active =
      typeof incomingSystem.active === "boolean" ? incomingSystem.active : true;

    const turnDuration = toTurns(
      incomingFlags.turnDuration,
      toTurns(incomingSystem.durationRounds, 0),
    );
    const remainingTurns = active
      ? toTurns(incomingFlags.remainingTurns, turnDuration)
      : 0;
    const ownerActorId = String(
      incomingFlags.ownerActorId ?? itemDoc?.parent?.id ?? "",
    ).trim();
    const activeCombat = game.combat?.started ? game.combat : null;
    const appliedRound = Number.isFinite(Number(incomingFlags.appliedRound))
      ? Number(incomingFlags.appliedRound)
      : Number.isFinite(Number(activeCombat?.round))
        ? Number(activeCombat.round)
        : null;
    const appliedTurn = Number.isFinite(Number(incomingFlags.appliedTurn))
      ? Number(incomingFlags.appliedTurn)
      : Number.isFinite(Number(activeCombat?.turn))
        ? Number(activeCombat.turn)
        : null;
    const appliedActorId = String(
      incomingFlags.appliedActorId ?? ownerActorId,
    ).trim();

    itemDoc.updateSource({
      "system.active": active,
      "system.durationRounds": turnDuration,
      "system.durationRemaining": remainingTurns,
      "flags.mySystem.turnDuration": turnDuration,
      "flags.mySystem.remainingTurns": remainingTurns,
      "flags.mySystem.ownerActorId": ownerActorId,
      "flags.mySystem.appliedRound": appliedRound,
      "flags.mySystem.appliedTurn": appliedTurn,
      "flags.mySystem.appliedActorId": appliedActorId,
    });
  });

  Hooks.on("preUpdateItem", (itemDoc, change) => {
    const next = extractPatchTurnState(itemDoc, change);
    if (!next) return;

    change.system = change.system ?? {};
    change.flags = change.flags ?? {};
    change.flags[FLAG_SCOPE] = change.flags[FLAG_SCOPE] ?? {};

    change.system.active = next.active;
    change.system.durationRounds = next.turnDuration;
    change.system.durationRemaining = next.remainingTurns;
    change.flags[FLAG_SCOPE].turnDuration = next.turnDuration;
    change.flags[FLAG_SCOPE].remainingTurns = next.remainingTurns;
    change.flags[FLAG_SCOPE].ownerActorId =
      next.ownerActorId || itemDoc?.actor?.id || "";
  });

  Hooks.on("createItem", async (item, options, userId) => {
    if (game.user.id !== userId) return;
    if (item.type !== "state") return;
    const timing = readTurnState(item);
    if (timing.active && timing.remainingTurns > 0) {
      await createStateEffect(item);
    }
  });

  Hooks.on("updateItem", async (item, change, options, userId) => {
    if (game.user.id !== userId) return;
    if (item.type !== "state") return;

    const hasActiveChanged =
      hasOwn(change, "system.active") || hasOwn(change?.system ?? {}, "active");
    const hasDurationChanged =
      hasOwn(change, "system.durationRemaining") ||
      hasOwn(change?.system ?? {}, "durationRemaining") ||
      hasOwn(change, `flags.${FLAG_SCOPE}.remainingTurns`) ||
      hasOwn(change?.flags?.[FLAG_SCOPE] ?? {}, "remainingTurns");
    const hasImgChanged = hasOwn(change, "img");
    const hasNameChanged = hasOwn(change, "name");

    const timing = readTurnState(item);
    if (hasActiveChanged || (hasDurationChanged && timing.remainingTurns <= 0)) {
      if (timing.active && timing.remainingTurns > 0) {
        const exists = item.actor?.effects?.some(
          (ef) => ef.origin && ef.origin.includes(item.uuid),
        );
        if (!exists) await createStateEffect(item);
      } else {
        await deleteStateEffects(item);
      }
    } else if (timing.active && (hasImgChanged || hasNameChanged)) {
      const effect = item.actor?.effects?.find(
        (ef) => ef.origin && ef.origin.includes(item.uuid),
      );
      if (effect) {
        const iconPath = item.img || "icons/svg/aura.svg";
        await effect.update({
          name: item.name,
          label: item.name,
          icon: iconPath,
          img: iconPath,
        });
      }
    } else if (timing.active && hasDurationChanged) {
      const effect = item.actor?.effects?.find(
        (ef) => ef.origin && ef.origin.includes(item.uuid),
      );
      if (effect) {
        await effect.update({
          duration: {
            turns: Math.max(1, timing.remainingTurns || timing.turnDuration || 1),
          },
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
      observedCombatTurns.set(combat.id, getCombatSnapshot(combat));
    }
  });

  Hooks.on("createCombat", (combat) => {
    observedCombatTurns.set(combat.id, getCombatSnapshot(combat));
  });

  Hooks.on("deleteCombat", (combat) => {
    observedCombatTurns.delete(combat.id);
  });

  Hooks.on("updateCombat", async (combat, change) => {
    if (!isPrimaryGM()) return;
    if (!combat) return;

    const hadTurnChange = hasOwn(change, "turn") || hasOwn(change, "round");
    if (!hadTurnChange) return;

    const prev = observedCombatTurns.get(combat.id) ?? null;
    const next = getCombatSnapshot(combat);
    observedCombatTurns.set(combat.id, next);

    // Do not consume durations when combat is not running.
    if (combat.started === false) return;

    const turnBoundaryChanged =
      !!prev &&
      (prev.combatantId !== next.combatantId ||
        prev.turn !== next.turn ||
        prev.round !== next.round);

    if (turnBoundaryChanged) {
      const endedActorId = String(prev.actorId ?? "").trim();
      if (endedActorId) {
        const endedCombatant = combat.combatants?.get(prev.combatantId) ?? null;
        const actor =
          endedCombatant?.actor ?? game.actors?.get(endedActorId) ?? null;
        if (actor) {
          // END OF TURN: apply DoT/HoT first.
          await applyOverTimeEffectsForActor(actor, "end");
          // Then reduce state duration with existing logic.
          await tickActorOwnedStates(actor, endedActorId, {
            endedRound: prev.round,
            endedTurn: prev.turn,
          });
        }
      }
    }

    const startedActorId = String(next.actorId ?? "").trim();
    if (!startedActorId) return;
    const startedCombatant = next.combatantId
      ? combat.combatants?.get(next.combatantId) ?? null
      : null;
    const startedActor =
      startedCombatant?.actor ?? game.actors?.get(startedActorId) ?? null;
    if (!startedActor) return;
    // START OF TURN: first remove states that expire at turn start, then apply DoT/HoT.
    await expireStatesOnTurnStartForActor(startedActor);
    await applyOverTimeEffectsForActor(startedActor, "start");
  });
};
