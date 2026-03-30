import { VitruviumCharacterSheet } from "./character-sheet.js";
import { VitruviumAbilitySheet } from "./ability-sheet.js";
import { VitruviumItemSheet } from "./item-sheet.js";
import { VitruviumSkillSheet } from "./skill-sheet.js";
import { VitruviumNPCSheet } from "./npc-sheet.js";
import { patchVitruviumInitiative } from "./initiative.js";
import { VitruviumDie } from "./dv-die.js";
import "./dice-so-nice.js";
import {
  startAbilityAttackFlow,
  startWeaponAttackFlow,
  replaceStateFromTemplate,
} from "./combat.js";
import { registerVitruviumTests } from "./tests.js";
import { registerStateDurationHooks } from "./state-duration.js";
import { setupFloatingTextHook, showFloatingText } from "./floating-text.js";

Hooks.once("init", () => {
  console.log("Vitruvium | Initializing system");

  // Migration: convert old NPC attribute format to new format
  Hooks.on("ready", async () => {
    if (!game.user.isGM) return;

    const npcActors = game.actors.filter((a) => a.type === "npc");
    const updates = [];

    for (const actor of npcActors) {
      const attrs = actor.system?.attributes ?? {};
      const needsUpdate = {};

      // Convert flat number attributes to {value: X}
      for (const key of [
        "condition",
        "attention",
        "movement",
        "combat",
        "thinking",
        "communication",
      ]) {
        const attr = attrs[key];
        if (typeof attr === "number") {
          needsUpdate[`system.attributes.${key}.value`] = attr;
        } else if (attr === undefined || attr === null) {
          needsUpdate[`system.attributes.${key}.value`] = 1;
        }
      }

      // Ensure hp has value and max
      const hp = attrs.hp ?? {};
      if (typeof hp.value !== "number")
        needsUpdate["system.attributes.hp.value"] = 5;
      if (typeof hp.max !== "number")
        needsUpdate["system.attributes.hp.max"] = 5;

      // Ensure armor exists
      if (!attrs.armor || typeof attrs.armor.value !== "number") {
        needsUpdate["system.attributes.armor.value"] = 0;
      }

      // Ensure speed exists
      if (!attrs.speed || typeof attrs.speed.value !== "number") {
        needsUpdate["system.attributes.speed.value"] = 0;
      }

      // Ensure inspiration exists
      const insp = attrs.inspiration ?? {};
      if (typeof insp.value !== "number")
        needsUpdate["system.attributes.inspiration.value"] = 6;
      if (typeof insp.max !== "number")
        needsUpdate["system.attributes.inspiration.max"] = 6;

      if (Object.keys(needsUpdate).length > 0) {
        updates.push(actor.update(needsUpdate));
      }
    }

    if (updates.length > 0) {
      console.log(`Vitruvium | Migrating ${updates.length} NPC actors`);
      await Promise.all(updates);
      console.log("Vitruvium | Migration complete");
    }
  });

  patchVitruviumInitiative();
  registerStateDurationHooks();
  setupFloatingTextHook();

  // Register Handlebars helper for incrementing numbers
  Handlebars.registerHelper("inc", (value) => Number(value) + 1);

  // Register Handlebars helper for grouping options by category
  Handlebars.registerHelper(
    "grouped_options",
    function (effectTargets, options) {
      const selectedValue = options.hash.selected;
      const groups = {};

      // Group effects by their group property
      for (const target of effectTargets) {
        const group = target.group || "other";
        if (!groups[group]) {
          groups[group] = [];
        }
        groups[group].push(target);
      }

      let result = "";
      for (const [groupName, groupItems] of Object.entries(groups)) {
        if (groupItems.length > 0) {
          result += `<optgroup label="${groupName}">`;
          for (const item of groupItems) {
            const isSelected = selectedValue
              ? item.key === selectedValue
              : item === groupItems[0];
            result += `<option value="${item.key}"${isSelected ? " selected" : ""}>${item.label}</option>`;
          }
          result += "</optgroup>";
        }
      }

      return new Handlebars.SafeString(result);
    },
  );

  const NS = game.system.id; // у тебя это "Vitruvium"

  game.settings.register(NS, "enableAutomatedAnimations", {
    name: "Включить Auto Animations",
    hint: "Если появляются предупреждения WebGL или визуальные подвисания, отключите и проверьте поведение чата.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

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
        (token) => token.actorId === actorDoc.id && token.actorLink,
      );
      if (!linkedTokens.length) continue;
      updates.push(
        scene.updateEmbeddedDocuments(
          "Token",
          linkedTokens.map((token) => ({ _id: token.id, name: newName })),
        ),
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
  game.vitruvium.replaceStateFromTemplate = replaceStateFromTemplate;
  game.vitruvium.showFloatingText = showFloatingText;
  registerVitruviumTests();
});
