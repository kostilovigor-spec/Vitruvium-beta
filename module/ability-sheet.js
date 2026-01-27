import { EFFECT_TARGETS, normalizeEffects } from "./effects.js";

export class VitruviumAbilitySheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "ability"],
      template: "systems/Vitruvium/templates/item/ability-sheet.hbs",
      width: 860,
      height: 520,
      resizable: true,

      // ВАЖНО: мы сохраняем вручную по кнопке "Готово"
      submitOnChange: false,
      submitOnClose: false,
    });
  }

  getData() {
    const data = super.getData();

    // Унифицируем доступ к system
    const sys = data.system ?? data.item?.system ?? this.item.system ?? {};
    if (!Number.isFinite(Number(sys.rollDamageBase))) sys.rollDamageBase = 0;
    if (!Number.isFinite(Number(sys.rollDamageDice))) sys.rollDamageDice = 0;
    if (!Number.isFinite(Number(sys.rollSaveBase))) sys.rollSaveBase = 0;
    if (!Number.isFinite(Number(sys.rollSaveDice))) sys.rollSaveDice = 0;
    if (!Number.isFinite(Number(sys.actions))) sys.actions = 1;
    if (Number(sys.rollDamageDice) === 0 && Number(sys.rollSaveDice) === 0) {
      const legacyMode = String(sys.rollMode ?? "none");
      const legacyDice = Number.isFinite(Number(sys.rollDice))
        ? Number(sys.rollDice)
        : 0;
      if (legacyMode === "damage") sys.rollDamageDice = legacyDice;
      if (legacyMode === "save") sys.rollSaveDice = legacyDice;
    }
    data.system = sys;

    const desc = String(sys.description ?? "");
    const safe = foundry.utils.escapeHTML(desc).replace(/\n/g, "<br>");
    data.vitruvium = data.vitruvium || {};
    const attrLabels = {
      condition: "Самочувствие",
      attention: "Внимание",
      movement: "Движение",
      combat: "Сражение",
      thinking: "Мышление",
      communication: "Общение",
      will: "Воля",
    };
    const allowed = [
      "condition",
      "attention",
      "movement",
      "combat",
      "thinking",
      "communication",
    ];
    const actorAttrs = this.item?.parent?.system?.attributes ?? {};
    const keys = allowed.filter((k) => typeof actorAttrs[k] === "number");
    const finalKeys = keys.length ? keys : allowed;
    const defaultAttr = finalKeys.includes(sys.attackAttr)
      ? sys.attackAttr
      : finalKeys.includes("combat")
      ? "combat"
      : finalKeys[0];
    data.vitruvium.attackAttrOptions = finalKeys.map((key) => ({
      key,
      label: attrLabels[key] ?? key,
    }));
    data.vitruvium.attackAttrDefault = defaultAttr;
    data.vitruvium.descriptionHTML = safe;
    data.vitruvium.effectTargets = EFFECT_TARGETS;
    data.vitruvium.effects = normalizeEffects(sys.effects, { keepZero: true });

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Always allow icon editing (independent of edit mode)
    // Always allow icon editing for abilities
    html
      .find("img[data-edit='img']")
      .off("click.vitruvium-img")
      .on("click.vitruvium-img", (ev) => {
        ev.preventDefault();

        new FilePicker({
          type: "image",
          current: this.item.img,
          callback: async (path) => {
            await this.item.update({ img: path });
          },
        }).browse();
      });

    // Функционал режима редактирования
    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };

    const $name = html.find("input[name='name']");
    const $level = html.find("input[name='system.level']");
    const $cost = html.find("input[name='system.cost']");
    const $actions = html.find("input[name='system.actions']");
    const $desc = html.find("textarea[name='system.description']");
    const $rollDamageBase = html.find("input[name='system.rollDamageBase']");
    const $rollDamage = html.find("input[name='system.rollDamageDice']");
    const $rollSaveBase = html.find("input[name='system.rollSaveBase']");
    const $rollSave = html.find("input[name='system.rollSaveDice']");
    const $active = html.find("input[name='system.active']");
    const $attackAttr = html.find("select[name='system.attackAttr']");

    const form = html.closest("form");
    const view = html.find("[data-role='desc-view']");
    const edit = html.find("[data-role='desc-edit']");
    const btn = html.find("[data-action='toggle-desc']");

    const setMode = (isEdit) => {
      form.toggleClass("is-edit", isEdit);
      btn.toggleClass("is-active", isEdit);
      btn.attr("title", isEdit ? "Готово" : "Редактировать");
      if (isEdit) edit.trigger("focus");
    };

    if (this._editing === undefined) this._editing = false;
    setMode(this._editing);

    const exitEditAndSave = async () => {
      const newName = String($name.val() ?? this.item.name);
      const newLevel = clamp(
        num($level.val(), num(this.item.system?.level, 1)),
        1,
        6
      );
      const newCost = clamp(
        num($cost.val(), num(this.item.system?.cost, 1)),
        0,
        6
      );
      const newActions = clamp(
        num($actions.val(), num(this.item.system?.actions, 1)),
        1,
        2
      );
      const newDesc = String($desc.val() ?? "");
      const newRollDamageBase = clamp(
        num($rollDamageBase.val(), num(this.item.system?.rollDamageBase, 0)),
        0,
        99
      );
      const newRollDamageDice = clamp(
        num($rollDamage.val(), num(this.item.system?.rollDamageDice, 0)),
        0,
        20
      );
      const newRollSaveBase = clamp(
        num($rollSaveBase.val(), num(this.item.system?.rollSaveBase, 0)),
        0,
        99
      );
      const newRollSaveDice = clamp(
        num($rollSave.val(), num(this.item.system?.rollSaveDice, 0)),
        0,
        20
      );
      const newAttackAttr = String(
        $attackAttr.val() ?? this.item.system?.attackAttr ?? "combat"
      );

      await this.item.update({
        name: newName,
        "system.level": newLevel,
        "system.cost": newCost,
        "system.actions": newActions,
        "system.rollDamageBase": newRollDamageBase,
        "system.rollDamageDice": newRollDamageDice,
        "system.rollSaveBase": newRollSaveBase,
        "system.rollSaveDice": newRollSaveDice,
        "system.attackAttr": newAttackAttr,
        "system.description": newDesc,
      });
    };

    btn.on("click", async (ev) => {
      ev.preventDefault();
      this._editing = !this._editing;
      setMode(this._editing);
      if (!this._editing) {
        await exitEditAndSave();
      }
    });

    $active.on("change", async (ev) => {
      await this.item.update({ "system.active": ev.currentTarget.checked });
    });
    $attackAttr.on("change", async (ev) => {
      await this.item.update({
        "system.attackAttr": String(ev.currentTarget.value ?? "combat"),
      });
    });

    const renderEffectRow = (effect = {}) => {
      const key = EFFECT_TARGETS.find((t) => t.key === effect.key)?.key;
      const value = Number.isFinite(effect.value) ? effect.value : 0;
      const options = EFFECT_TARGETS.map((opt, idx) => {
        const selected = key ? opt.key === key : idx === 0 ? true : false;
        return `<option value="${opt.key}"${
          selected ? " selected" : ""
        }>${opt.label}</option>`;
      }).join("");

      return `
        <div class="v-effects__row">
          <select class="v-effects__key">${options}</select>
          <input type="number" class="v-effects__val" value="${value}" step="1" />
          <button type="button" class="v-mini v-effects__remove" title="Удалить">x</button>
        </div>
      `;
    };

    const updateEffects = async () => {
      const next = [];
      html.find(".v-effects__row").each((_, row) => {
        const $row = $(row);
        const key = String($row.find(".v-effects__key").val() ?? "");
        const value = num($row.find(".v-effects__val").val(), 0);
        if (!EFFECT_TARGETS.find((t) => t.key === key)) return;
        if (!Number.isFinite(value) || value === 0) return;
        next.push({ key, value });
      });
      await this.item.update({ "system.effects": next });
    };

    html.on("click", "[data-action='add-effect']", (ev) => {
      ev.preventDefault();
      html.find(".v-effects__rows").append(renderEffectRow());
    });

    html.on("click", ".v-effects__remove", (ev) => {
      ev.preventDefault();
      $(ev.currentTarget).closest(".v-effects__row").remove();
      if (!html.find(".v-effects__row").length) {
        html.find(".v-effects__rows").append(renderEffectRow());
      }
      updateEffects();
    });

    html.on("change", ".v-effects__key, .v-effects__val", () => {
      updateEffects();
    });
  }
}
