import { openModifierEditor, presentModifiers } from "./core/modifier-system.js";

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

    data.vitruvium = data.vitruvium || {};
    data.vitruvium.modifierRows = presentModifiers(sys.modifiers);

    const tabBase = `v-tabs-${this.appId}`;
    data.vitruvium.tabName = tabBase;
    data.vitruvium.tabIds = {
      desc: `${tabBase}-desc`,
      effects: `${tabBase}-effects`,
    };
    data.vitruvium.activeTab = this._effectTab ?? "desc";

    return data;
  }

  async close(options) {
    try {
      await this._updateObject({}, this._getSubmitData());
      if (typeof this._saveDescOnClose === "function") {
        await this._saveDescOnClose();
      }
    } catch (e) {
      /* ignore */
    }
    return super.close(options);
  }

  async _updateObject(_event, formData) {
    for (const key of Object.keys(formData)) {
      if (key.startsWith("v-tabs-")) delete formData[key];
    }
    return this.item.update(formData);
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".v-tab-link").on("click", (ev) => {
      ev.preventDefault();
      this._effectTab = ev.currentTarget.dataset.tab;
      this.render();
    });

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

    html.on("click", "[data-action='edit-modifiers']", async (ev) => {
      ev.preventDefault();
      await openModifierEditor(this.item);
      this.render();
    });
  }
}

