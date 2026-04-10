import { openModifierEditor } from "./core/modifier-system.js";

export class VitruviumEffectSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "effect"],
      template: "systems/Vitruvium/templates/item/effect-sheet.hbs",
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

  async close(options) {
    try {
      if (typeof this._saveDescOnClose === "function") {
        await this._saveDescOnClose();
      }
    } catch (e) {
      /* ignore */
    }
    return super.close(options);
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Immediate save for name on change.
    const $name = html.find("input[name='name']");
    $name.on("change", async () => {
      const v = String($name.val() ?? this.item.name);
      if (v && v !== this.item.name) await this.item.update({ name: v });
    });

    // Immediate save for description on blur.
    const $desc = html.find("textarea[name='system.description']");
    const saveDescriptionDraft = async () => {
      const newDesc = String($desc.val() ?? "");
      if (newDesc !== String(this.item.system?.description ?? "")) {
        await this.item.update({ "system.description": newDesc });
      }
    };
    this._saveDescOnClose = saveDescriptionDraft;

    $desc.on("blur", async () => {
      await saveDescriptionDraft();
    });

    html.find("[data-action='edit-modifiers']").on("click", async (ev) => {
      ev.preventDefault();
      await openModifierEditor(this.item);
    });
  }
}

