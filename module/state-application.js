import { toNumber } from "./utils/number.js";
import { getStateTemplateByUuid } from "./state-library.js";

/**
 * Применяет состояние из шаблона к актору.
 * Заменяет старые состояния с таким же именем.
 * 
 * @param {Actor} defenderActor - Актор, на которого накладывается состояние
 * @param {string} templateUuid - UUID шаблона состояния из state-library
 * @param {number|null} durationOverrideRounds - Длительность в раундах (null = из шаблона)
 * @param {string|null} defenderTokenUuid - UUID токена защитника
 * @returns {Promise<{applied: boolean, stateName: string|null}>}
 */
export async function replaceStateFromTemplate(
  defenderActor,
  templateUuid,
  durationOverrideRounds = null,
  defenderTokenUuid = null,
) {
  const templateDoc = await getStateTemplateByUuid(templateUuid);
  if (!templateDoc) return { applied: false, stateName: null };

  const oldStateIds = (defenderActor.items ?? [])
    .filter((it) => it.type === "state" && it.name === templateDoc.name)
    .map((it) => it.id);

  // Delete old states with the same name.
  // The deleteItem hook in state-duration.js will automatically clean up their icons.
  if (oldStateIds.length) {
    await defenderActor.deleteEmbeddedDocuments("Item", oldStateIds);
  }

  const sourceSystem = foundry.utils.deepClone(templateDoc.system ?? {});
  const sourceMyFlags = foundry.utils.deepClone(
    templateDoc.flags?.mySystem ?? {},
  );
  const durationTurns =
    durationOverrideRounds === null || durationOverrideRounds === undefined
      ? Math.max(0, Math.round(toNumber(sourceSystem.durationRounds, 0)))
      : Math.max(0, Math.round(toNumber(durationOverrideRounds, 0)));
  const activeCombat = game.combat?.started ? game.combat : null;
  const appliedRound = Number.isFinite(Number(activeCombat?.round))
    ? Number(activeCombat.round)
    : null;
  const appliedTurn = Number.isFinite(Number(activeCombat?.turn))
    ? Number(activeCombat.turn)
    : null;
  sourceSystem.active = true;
  sourceSystem.durationRounds = durationTurns;
  sourceSystem.durationRemaining = durationTurns;

  const createdState = await defenderActor.createEmbeddedDocuments("Item", [
    {
      name: templateDoc.name,
      type: "state",
      img: templateDoc.img ?? "icons/svg/aura.svg",
      system: sourceSystem,
      flags: {
        mySystem: {
          ...sourceMyFlags,
          turnDuration: durationTurns,
          remainingTurns: durationTurns,
          ownerActorId: defenderActor.id,
          appliedRound,
          appliedTurn,
          appliedActorId: defenderActor.id,
        },
      },
    },
  ]);

  // Note: The createItem hook in state-duration.js will automatically create the icon.

  return { applied: true, stateName: templateDoc.name };
}
