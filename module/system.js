import { VitruviumCharacterSheet } from "./character-sheet.js";
import { VitruviumAbilitySheet } from "./ability-sheet.js";
import { VitruviumItemSheet } from "./item-sheet.js";
import { VitruviumNPCSheet } from "./npc-sheet.js";
import { patchVitruviumInitiative } from "./initiative.js";
import "./dice-so-nice.js";

Hooks.once("init", () => {
  console.log("Vitruvium | Initializing system");
  patchVitruviumInitiative();

  const NS = game.system.id; // у тебя это "Vitruvium"

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
});
