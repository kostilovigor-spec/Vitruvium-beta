import { VitruviumCharacterSheet } from "./character-sheet.js";
import { VitruviumAbilitySheet } from "./ability-sheet.js";
import { VitruviumItemSheet } from "./item-sheet.js";
import { VitruviumSkillSheet } from "./skill-sheet.js";
import { VitruviumNPCSheet } from "./npc-sheet.js";
import { patchVitruviumInitiative } from "./initiative.js";
import { VitruviumDie } from "./dv-die.js";
import "./dice-so-nice.js";
import { startAbilityAttackFlow, startWeaponAttackFlow } from "./combat.js";
import { registerVitruviumTests } from "./tests.js";

Hooks.once("init", () => {
  console.log("Vitruvium | Initializing system");
  patchVitruviumInitiative();

  const NS = game.system.id; // у тебя это "Vitruvium"

  CONFIG.Dice.terms["V"] = VitruviumDie;
  CONFIG.Dice.terms["v"] = VitruviumDie;

  // Actor sheet
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet(NS, VitruviumCharacterSheet, {
    types: ["character"],
    makeDefault: true,
  });

  Actors.registerSheet("Vitruvium", VitruviumNPCSheet, {
    label: "Vitruvium (NPC)",
    types: ["npc"],
    makeDefault: true,
  });

  // Item sheets
  Items.unregisterSheet("core", ItemSheet);

  Items.registerSheet(NS, VitruviumAbilitySheet, {
    types: ["ability"],
    makeDefault: true,
  });

  Items.registerSheet(NS, VitruviumItemSheet, {
    types: ["item"],
    makeDefault: true,
  });

  Items.registerSheet(NS, VitruviumSkillSheet, {
    types: ["skill"],
    makeDefault: true,
  });

  Items.registerSheet(NS, VitruviumSkillSheet, {
    types: ["state"],
    makeDefault: true,
  });

  // Tokens: auto-pull name + portrait from actor on creation
  Hooks.on("preCreateActor", (actorDoc, data) => {
    if (!["character", "npc"].includes(actorDoc.type)) return;
    const updates = {
      "prototypeToken.actorLink": true,
      "prototypeToken.displayBars": CONST.TOKEN_DISPLAY_MODES.OWNER,
      "prototypeToken.bar1.attribute": "attributes.hp",
    };
    actorDoc.updateSource(updates);
  });

  Hooks.on("preUpdateActor", (actorDoc, change) => {
    if (!["character", "npc"].includes(actorDoc.type)) return;
    if (!("name" in change)) return;
    change.prototypeToken = change.prototypeToken ?? {};
    change.prototypeToken.name = change.name;
  });

  Hooks.on("updateActor", async (actorDoc, change) => {
    if (!["character", "npc"].includes(actorDoc.type)) return;
    if (!("name" in change)) return;
    const newName = actorDoc.name;
    const updates = [];
    for (const scene of game.scenes) {
      if (!scene.isOwner) continue;
      const linkedTokens = scene.tokens.filter(
        (token) => token.actorId === actorDoc.id && token.actorLink
      );
      if (!linkedTokens.length) continue;
      updates.push(
        scene.updateEmbeddedDocuments(
          "Token",
          linkedTokens.map((token) => ({ _id: token.id, name: newName }))
        )
      );
    }
    if (updates.length) await Promise.allSettled(updates);
  });

  Hooks.on("preCreateToken", (tokenDoc, data) => {
    const actor = tokenDoc?.actor;
    if (!actor) return;
    const next = {};
    if (!data?.name) next.name = actor.name;
    const src = data?.texture?.src ?? tokenDoc?.texture?.src;
    if (!src || src === "icons/svg/mystery-man.svg") {
      next.texture = { src: actor.img };
    }
    if (Object.keys(next).length) tokenDoc.updateSource(next);
  });

  game.vitruvium = game.vitruvium ?? {};
  game.vitruvium.startAbilityAttackFlow = startAbilityAttackFlow;
  game.vitruvium.startWeaponAttackFlow = startWeaponAttackFlow;
  registerVitruviumTests();
});
