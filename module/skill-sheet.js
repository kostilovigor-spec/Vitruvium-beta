import { openEffectsDialog } from "./effects.js";

export class VitruviumSkillSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "skill"],
      template: "systems/Vitruvium/templates/item/skill-sheet.hbs",
      width: 720,
      height: 520,
      submitOnChange: true,
      submitOnClose: true,
      resizable: true,
    });
  }

  getData() {
    const data = super.getData();
    const sys = data.system ?? data.item?.system ?? this.item.system ?? {};
    data.system = sys;
    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("[data-action='edit-effects']").on("click", async (ev) => {
      ev.preventDefault();
      await openEffectsDialog(this.item);
    });
  }
}
