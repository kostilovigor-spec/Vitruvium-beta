import { EFFECT_TARGETS, normalizeEffects } from "./effects.js";

export class VitruviumItemSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "item"],
      template: "systems/Vitruvium/templates/item/item-sheet.hbs",
      width: 720,
      height: 520,
      submitOnChange: true,
      submitOnClose: true,
      resizable: true,
    });
  }

  getData() {
    const data = super.getData();

    // Унифицируем доступ к system (в разных версиях Foundry контекст отличается)
    const sys = data.system ?? data.item?.system ?? this.item.system ?? {};
    if (!Number.isFinite(Number(sys.actions))) sys.actions = 1;
    data.system = sys;

    const desc = String(sys.description ?? "");

    // Готовим HTML для режима "чтение"
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

    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };

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

    btn.on("click", async (ev) => {
      ev.preventDefault();

      // переключаем режим
      this._editing = !this._editing;
      setMode(this._editing);

      // если выключаем редактирование - сохраняем напрямую в Item
      if (!this._editing) {
        const text = String(edit.val() ?? "");
        await this.item.update({ "system.description": text });
        // После update Foundry перерендерит лист, и getData() снова заполнит descriptionHTML
        return;
      }
    });

    // Clamp item bonuses to 0..6 (only for item type)
    if (this.item.type === "item") {
      html.find("input[name='system.attackBonus']").on("change", async (ev) => {
        const v = clamp(num(ev.currentTarget.value, 0), 0, 6);
        await this.item.update({ "system.attackBonus": v });
      });

      html.find("input[name='system.armorBonus']").on("change", async (ev) => {
        const v = clamp(num(ev.currentTarget.value, 0), 0, 6);
        await this.item.update({ "system.armorBonus": v });
      });

      html.find("input[name='system.actions']").on("change", async (ev) => {
        const v = clamp(num(ev.currentTarget.value, 1), 1, 2);
        await this.item.update({ "system.actions": v });
      });
    }

    const renderEffectRow = (effect = {}) => {
      const key = EFFECT_TARGETS.find((t) => t.key === effect.key)?.key;
      const value = Number.isFinite(effect.value) ? effect.value : 0;
      const options = EFFECT_TARGETS.map((opt, idx) => {
        const selected =
          key ? opt.key === key : idx === 0 ? true : false;
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
