import { VitruviumCharacterSheet } from "./character-sheet.js";
import {
  collectEffectTotals,
  getEffectValue,
  getGlobalRollModifiers,
} from "./effects.js";
import { rollSuccessDice } from "./rolls.js";

export class VitruviumNPCSheet extends VitruviumCharacterSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "actor", "npc"],
      template: "systems/Vitruvium/templates/actor/npc-sheet.hbs",
      width: 640,
      height: 640,
    });
  }

  getData() {
    const data = ActorSheet.prototype.getData.call(this);

    const sys = data.system ?? this.actor.system ?? {};
    const attrs = sys.attributes ?? {};
    const effectTotals = collectEffectTotals(this.actor);

    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };

    const getAttr = (k) => {
      const base = num(attrs[k], 0);
      const total = base + getEffectValue(effectTotals, k);
      return Number.isFinite(total) ? total : base;
    };

    data.vitruvium = data.vitruvium ?? {};
    data.vitruvium.items = this.actor.items.filter((i) => i.type === "item");
    data.vitruvium.abilities = (this.actor.items ?? []).filter(
      (i) => i.type === "ability"
    );

    const savedTab = this.actor.getFlag(game.system.id, "activeTab");
    data.vitruvium.activeTab = savedTab === "abi" ? "abi" : "inv";

    const attrLabels = {
      condition: "Самочувствие",
      attention: "Внимание",
      movement: "Движение",
      combat: "Сражение",
      thinking: "Мышление",
      communication: "Общение",
    };
    const allowed = [
      "condition",
      "attention",
      "movement",
      "combat",
      "thinking",
      "communication",
    ];
    const keys = allowed.filter((k) => typeof attrs[k] === "number");
    const finalKeys = keys.length ? keys : allowed;
    data.vitruvium.attributes = finalKeys.map((key) => ({
      key,
      label: attrLabels[key] ?? key,
      value: getAttr(key),
    }));

    const insp = attrs.inspiration ?? { value: 6, max: 6 };
    const inspMaxBase = clamp(num(insp.max, 6), 0, 99);
    const inspMax = clamp(
      inspMaxBase + getEffectValue(effectTotals, "inspMax"),
      0,
      99
    );
    const inspValue = clamp(num(insp.value, inspMax), 0, inspMax);
    data.vitruvium.inspiration = { value: inspValue, max: inspMax };

    const hp = attrs.hp ?? { value: 0, max: 0 };
    const hpMax = clamp(num(hp.max, 0), 0, 999);
    const hpValue = clamp(num(hp.value, hpMax), 0, hpMax);
    data.vitruvium.hp = { value: hpValue, max: hpMax };

    data.system = data.system || {};
    data.system.attributes = data.system.attributes || {};
    data.system.attributes.hp = data.system.attributes.hp || {};
    data.system.attributes.hp.value = hpValue;
    data.system.attributes.hp.max = hpMax;

    const scope = game.system.id;
    const savedExtra = this.actor.getFlag(scope, "extraDice");
    data.vitruvium.extraDice = clamp(num(savedExtra, 2), 1, 20);

    // Armor total from equipped items (NPC)
    let bonusArmor = 0;
    const clamp6 = (n) => Math.min(Math.max(Number(n ?? 0), 0), 6);
    for (const it of this.actor.items) {
      if (it.type !== "item") continue;
      if (!it.system?.equipped) continue;
      bonusArmor += clamp6(it.system.armorBonus);
    }
    data.vitruvium.armorTotal = bonusArmor;

    const mv = getAttr("movement");
    data.vitruvium.speed = 5 + mv + getEffectValue(effectTotals, "speed");

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };

    const rollModeDialog = async (title) =>
      new Promise((resolve) => {
        const defaultLuck = 0;
        const defaultUnluck = 0;
        const defaultFullMode = "normal";
        new Dialog({
          title,
          content: `<div style="display:grid; gap:8px;">
            <label>Удачливый бросок
              <select name="fullMode" style="width:100%">
                <option value="normal" ${defaultFullMode === "normal" ? "selected" : ""}>Обычный</option>
                <option value="adv" ${defaultFullMode === "adv" ? "selected" : ""}>Удачливый (полный переброс)</option>
                <option value="dis" ${defaultFullMode === "dis" ? "selected" : ""}>Неудачливый (полный переброс)</option>
              </select>
            </label>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
              <label>Преимущество
                <input type="number" name="luck" value="${defaultLuck}" min="0" max="20" step="1" style="width:100%"/>
              </label>
              <label>Помеха
                <input type="number" name="unluck" value="${defaultUnluck}" min="0" max="20" step="1" style="width:100%"/>
              </label>
            </div>
            <div style="font-size:12px; opacity:.75;">Каждый счетчик преимущества/помехи перебрасывает один куб. Удачливый/неудачливый бросок игнорирует счетчики.</div>
          </div>`,
          buttons: {
            roll: {
              label: "Бросить",
              callback: (html) =>
                resolve({
                  luck: clamp(num(html.find("input[name='luck']").val(), 0), 0, 20),
                  unluck: clamp(
                    num(html.find("input[name='unluck']").val(), 0),
                    0,
                    20
                  ),
                  fullMode: html.find("select[name='fullMode']").val(),
                }),
            },
            cancel: { label: "Отмена", callback: () => resolve(null) },
          },
          default: "roll",
          close: () => resolve(null),
        }).render(true);
      });

    // Override attribute +/- to remove 1..6 clamp and auto-HP logic
    html.find("[data-action='attr-inc']").off("click").on("click", async (ev) => {
      ev.preventDefault();
      const key = ev.currentTarget.dataset.attr;
      const attrs = this.actor.system.attributes ?? {};
      const current = num(attrs[key], 0);
      const next = clamp(current + 1, 0, 99);
      await this.actor.update({ [`system.attributes.${key}`]: next });
    });

    html.find("[data-action='attr-dec']").off("click").on("click", async (ev) => {
      ev.preventDefault();
      const key = ev.currentTarget.dataset.attr;
      const attrs = this.actor.system.attributes ?? {};
      const current = num(attrs[key], 0);
      const next = clamp(current - 1, 0, 99);
      await this.actor.update({ [`system.attributes.${key}`]: next });
    });

    // Override attribute roll to avoid 1..6 clamp
    html
      .find("[data-action='roll-attribute']")
      .off("click")
      .on("click", async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget;
        const key = btn.dataset.attr;
        const label = btn.dataset.label ?? key;
        const attrs = this.actor.system.attributes ?? {};
        const effectTotals = collectEffectTotals(this.actor);
        const globalMods = getGlobalRollModifiers(effectTotals);
        const base = num(attrs[key], 0);
        const pool = Math.max(1, base + getEffectValue(effectTotals, key));
        const choice = await rollModeDialog(`Проверка: ${label}`);
        if (!choice) return;
        const rollLuck = choice.luck + globalMods.adv;
        const rollUnluck = choice.unluck + globalMods.dis;
        const rollFullMode =
          globalMods.fullMode !== "normal" ? globalMods.fullMode : choice.fullMode;

        await rollSuccessDice({
          pool,
          actorName: this.actor.name,
          checkName: label,
          luck: rollLuck,
          unluck: rollUnluck,
          fullMode: rollFullMode,
        });
      });

    // Override HP handlers to allow manual max
    const hpValueInput = html.find("input[name='system.attributes.hp.value']");
    const hpMaxInput = html.find("input[name='system.attributes.hp.max']");
    if (hpValueInput.length || hpMaxInput.length) {
      hpValueInput.off("input change blur keydown");
      hpMaxInput.off("input change blur keydown");
      html.find("button").off("mousedown");

      let hpTimer = null;

      const readHpMax = () => clamp(num(hpMaxInput.val(), 0), 0, 999);
      const readHpValue = (max) => clamp(num(hpValueInput.val(), 0), 0, max);

      const saveHpNow = async () => {
        const max = readHpMax();
        const value = readHpValue(max);
        const cur = this.actor.system.attributes?.hp ?? {};
        const curValue = num(cur.value, 0);
        const curMax = num(cur.max, 0);
        if (value === curValue && max === curMax) return;
        await this.actor.update({
          "system.attributes.hp.value": value,
          "system.attributes.hp.max": max,
        });
      };

      const scheduleSave = () => {
        if (hpTimer) clearTimeout(hpTimer);
        hpTimer = setTimeout(() => {
          hpTimer = null;
          saveHpNow().catch(console.error);
        }, 150);
      };

      hpValueInput.on("input", scheduleSave);
      hpMaxInput.on("input", scheduleSave);
      hpValueInput.on("change", scheduleSave);
      hpMaxInput.on("change", scheduleSave);
      hpValueInput.on("blur", scheduleSave);
      hpMaxInput.on("blur", scheduleSave);

      hpValueInput.on("keydown", async (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        ev.stopPropagation();
        if (hpTimer) clearTimeout(hpTimer);
        hpTimer = null;
        await saveHpNow();
        hpValueInput.blur();
      });

      hpMaxInput.on("keydown", async (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        ev.stopPropagation();
        if (hpTimer) clearTimeout(hpTimer);
        hpTimer = null;
        await saveHpNow();
        hpMaxInput.blur();
      });

      html.find("button").on("mousedown", async () => {
        if (!hpTimer) return;
        clearTimeout(hpTimer);
        hpTimer = null;
        await saveHpNow();
      });
    }
  }
}
