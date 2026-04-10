import { openModifierEditor, presentModifiers } from "./core/modifier-system.js";

export class VitruviumSkillSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "skill"],
      template: "systems/Vitruvium/templates/item/skill-sheet.hbs",
      width: 720,
      height: 520,
      submitOnChange: false,
      submitOnClose: false,
      resizable: true,
    });
  }

  async getData() {
    const data = await super.getData();
    const sys = data.system ?? data.item?.system ?? this.item.system ?? {};
    const isState = this.item.type === "state";
    const toRounds = (v, d = 0) => {
      const n = Number(v);
      const safe = Number.isFinite(n) ? n : d;
      return Math.max(0, Math.round(safe));
    };
    const stateActive = isState ? sys.active !== false : false;
    const turnDuration = isState
      ? toRounds(
          this.item?.flags?.mySystem?.turnDuration,
          toRounds(sys.durationRounds, 0),
        )
      : 0;
    const remainingTurns = isState
      ? toRounds(
          this.item?.flags?.mySystem?.remainingTurns,
          toRounds(sys.durationRemaining, stateActive ? turnDuration : 0),
        )
      : 0;
    data.system = sys;
    if (typeof sys.canBlock !== "boolean") sys.canBlock = false;
    if (isState) {
      data.system.active = stateActive;
      data.system.durationRounds = turnDuration;
      data.system.durationRemaining = remainingTurns;
    }
    const desc = String(sys.description ?? "");
    const safe = foundry.utils.escapeHTML(desc).replace(/\n/g, "<br>");
    data.vitruvium = data.vitruvium || {};
    data.vitruvium.descriptionHTML = safe;
    data.vitruvium.modifierRows = presentModifiers(sys.modifiers);
    data.vitruvium.modifierCount = Array.isArray(sys.modifiers)
      ? sys.modifiers.length
      : 0;
    data.vitruvium.isState = isState;
    data.vitruvium.expireOnTurnStart =
      this.item?.flags?.mySystem?.expireOnTurnStart === true;

    const tabBase = `v-tabs-${this.appId}`;
    data.vitruvium.tabName = tabBase;
    data.vitruvium.tabIds = {
      desc: `${tabBase}-desc`,
      effects: `${tabBase}-effects`,
    };
    data.vitruvium.activeTab = this._activeTab ?? "desc";

    return data;
  }

  async close(options) {
    try {
      if (typeof this._saveDescOnClose === "function") {
        await this._saveDescOnClose();
      }
    } catch (_e) {
      // ignore
    }
    return super.close(options);
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".v-tab-link").on("click", (ev) => {
      ev.preventDefault();
      this._activeTab = ev.currentTarget.dataset.tab;
      this.render();
    });

    html
      .find("img[data-edit='img']")
      .off("click.vitruvium-img")
      .on("click.vitruvium-img", (ev) => {
        ev.preventDefault();

        new FilePicker({
          type: "image",
          current: this.item.img,
          callback: async (path) => {
            const descVal = String(
              html.find("textarea[name='system.description']").val() ?? "",
            );
            await this.item.update({
              img: path,
              "system.description": descVal,
            });
          },
        }).browse();
      });

    const form = html.closest("form");
    const edit = html.find("[data-role='desc-edit']");

    const setMode = (isEdit) => {
      form.toggleClass("is-edit", isEdit);
      const $btn = html.find("[data-action='toggle-desc']");
      $btn.toggleClass("is-active", isEdit);
      $btn.attr("title", isEdit ? "Завершить редактирование" : "Редактировать");
      if (isEdit) edit.trigger("focus");
    };

    if (this._editing === undefined) this._editing = false;
    setMode(this._editing);

    const currentDesc = () =>
      String(html.find("textarea[name='system.description']").val() ?? this.item.system?.description ?? "");
    const saveDescriptionDraft = async () => {
      const newDesc = currentDesc();
      if (newDesc !== String(this.item.system?.description ?? "")) {
        await this.item.update({ "system.description": newDesc });
      }
    };
    this._saveDescOnClose = saveDescriptionDraft;

    const exitEditAndSave = async () => {
      const newName = String(html.find("input[name='name']").val() ?? this.item.name);
      const newDesc = currentDesc();
      await this.item.update({
        name: newName,
        "system.description": newDesc,
      });
    };

    html.on("click", "[data-action='toggle-desc']", async (ev) => {
      ev.preventDefault();
      this._editing = !this._editing;
      setMode(this._editing);
      if (!this._editing) {
        await exitEditAndSave();
      }
    });

    html.find("textarea[name='system.description']").on("blur", async () => {
      await saveDescriptionDraft();
    });

    html.find("input[name='name']").on("change", async () => {
      const v = String(html.find("input[name='name']").val() ?? this.item.name);
      if (v && v !== this.item.name) await this.item.update({ name: v });
    });

    html.find("input[name='system.active']").on("change", async (ev) => {
      const next = ev.currentTarget.checked;
      const turnDuration = Math.max(
        0,
        Math.round(
          Number(this.item.flags?.mySystem?.turnDuration ?? this.item.system?.durationRounds) || 0,
        ),
      );
      await this.item.update({
        "system.active": next,
        "system.durationRounds": turnDuration,
        "system.durationRemaining": next ? turnDuration : 0,
        "flags.mySystem.turnDuration": turnDuration,
        "flags.mySystem.remainingTurns": next ? turnDuration : 0,
        "flags.mySystem.ownerActorId": this.item.actor?.id ?? "",
      });
    });

    html.find("input[name='system.durationRounds']").on("change", async (ev) => {
      const v = Math.max(0, Math.round(Number(ev.currentTarget.value) || 0));
      const isActive = this.item.system?.active !== false;
      await this.item.update({
        "system.durationRounds": v,
        "system.durationRemaining": isActive ? v : 0,
        "flags.mySystem.turnDuration": v,
        "flags.mySystem.remainingTurns": isActive ? v : 0,
        "flags.mySystem.ownerActorId": this.item.actor?.id ?? "",
      });
    });

    html.find("input[name='flags.mySystem.expireOnTurnStart']").on("change", async (ev) => {
      await this.item.update({
        "flags.mySystem.expireOnTurnStart": ev.currentTarget.checked,
      });
    });

    html.find("input[name='system.canBlock']").on("change", async (ev) => {
      await this.item.update({ "system.canBlock": ev.currentTarget.checked });
    });

    html.on("click", "[data-action='edit-modifiers']", async (ev) => {
      ev.preventDefault();
      await openModifierEditor(this.item);
      this.render();
    });
  }
}
