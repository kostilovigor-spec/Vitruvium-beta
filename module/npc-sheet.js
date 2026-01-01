import { VitruviumCharacterSheet } from "./character-sheet.js";

export class VitruviumNPCSheet extends VitruviumCharacterSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "actor", "npc"],
      template: "systems/Vitruvium/templates/actor/npc-sheet.hbs",
      width: 720,
      height: 720,
    });
  }
}
