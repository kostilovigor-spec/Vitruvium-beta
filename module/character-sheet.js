import { rollSuccessDice } from "./rolls.js";
import {
  collectEffectTotals,
  getEffectValue,
  getEffectiveAttribute,
  getGlobalRollModifiers,
} from "./effects.js";
import { playAutomatedAnimation } from "./auto-animations.js";

// Character sheet: attributes, resources, items, and actions.
export class VitruviumCharacterSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "actor"],
      template: "systems/Vitruvium/templates/actor/character-sheet.hbs",
      width: 640,
      minWidth: 640,
      height: 720,
      // Keep auto-submit but handle HP manually to avoid losing input.
      submitOnChange: true,
      submitOnClose: true,
    });
  }

  getData() {
    const data = super.getData();

    // Resolve system data and attributes.
    const sys = data.system ?? this.actor.system ?? {};
    const attrs = sys.attributes ?? {};

    // Aggregate effects from items/abilities/states.
    const effectTotals = collectEffectTotals(this.actor);

    // Local helpers.
    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };
    // Attribute getter with effects applied.
    const getAttr = (k) => getEffectiveAttribute(attrs, k, effectTotals);

    data.vitruvium = data.vitruvium ?? {};
    data.vitruvium.items = this.actor.items.filter((i) => i.type === "item");
    data.vitruvium.abilities = (this.actor.items ?? []).filter(
      (i) => i.type === "ability"
    );
    data.vitruvium.skills = (this.actor.items ?? []).filter(
      (i) => i.type === "skill"
    );
    data.vitruvium.states = (this.actor.items ?? []).filter(
      (i) => i.type === "state"
    );

    // Inspiration: base max + effects.
    const insp = attrs.inspiration ?? { value: 6, max: 6 };
    const inspMaxBase = clamp(num(insp.max, 6), 0, 99);
    const inspMax = clamp(
      inspMaxBase + getEffectValue(effectTotals, "inspMax"),
      0,
      99
    );
    const inspValue = clamp(num(insp.value, inspMax), 0, inspMax);

    // HP max derived from condition + effects.
    const condition = getAttr("condition");
    const hpMax = Math.max(0, condition * 8 + getEffectValue(effectTotals, "hpMax"));
    const hp = attrs.hp ?? { value: hpMax, max: hpMax };
    const hpValue = clamp(num(hp.value, hpMax), 0, hpMax);

    // Flags scope (system id).
    const scope = game.system.id;
    const savedExtra = this.actor.getFlag(scope, "extraDice");
    const extraDice = clamp(num(savedExtra, 2), 1, 20);

    // Attribute icons for the template.
    const icons = {
      condition: "♥",
      attention: "◎",
      movement: "✜",
      combat: "⚔",
      thinking: "✦",
      communication: "☉",
    };

    data.vitruvium.attributes = [
      {
        key: "condition",
        label: "Самочувствие",
        value: getAttr("condition"),
        icon: icons.condition,
      },
      {
        key: "attention",
        label: "Внимание",
        value: getAttr("attention"),
        icon: icons.attention,
      },
      {
        key: "movement",
        label: "Движение",
        value: getAttr("movement"),
        icon: icons.movement,
      },
      {
        key: "combat",
        label: "Сражение",
        value: getAttr("combat"),
        icon: icons.combat,
      },
      {
        key: "thinking",
        label: "Мышление",
        value: getAttr("thinking"),
        icon: icons.thinking,
      },
      {
        key: "communication",
        label: "Общение",
        value: getAttr("communication"),
        icon: icons.communication,
      },
    ];

    // Active tab stored per actor.
    const savedTab = this.actor.getFlag(scope, "activeTab");
    data.vitruvium.activeTab =
      savedTab === "abi" || savedTab === "skill" || savedTab === "state"
        ? savedTab
        : "inv";

    data.vitruvium.inspiration = { value: inspValue, max: inspMax };
    data.vitruvium.hp = { value: hpValue, max: hpMax };
    data.vitruvium.extraDice = extraDice;
    data.vitruvium.level = Number(attrs.level ?? 1);

    // Keep HP in data.system for templates/tokens.
    data.system = data.system || {};
    data.system.attributes = data.system.attributes || {};
    data.system.attributes.hp = data.system.attributes.hp || {};
    data.system.attributes.hp.value = hpValue;
    data.system.attributes.hp.max = hpMax;

    // Armor total from equipped items only.
    let bonusArmor = 0;
    const clamp6 = (n) => Math.min(Math.max(Number(n ?? 0), 0), 6);
    for (const it of this.actor.items) {
      if (it.type !== "item") continue;
      const sysItem = it.system ?? {};
      if (!sysItem.equipped) continue;
      bonusArmor += clamp6(sysItem.armorBonus);
    }
    data.vitruvium.armorTotal = bonusArmor;

    // Speed = base + movement + effects.
    const mv = getAttr("movement");
    data.vitruvium.speed = 5 + mv + getEffectValue(effectTotals, "speed");

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Local helpers.
    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };
    // Escape helper for safe HTML in chat content.
    const esc = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");

    // Flags scope (system id).
    const scope = game.system.id;

    // Roll mode dialog (luck/unluck/fullMode).
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
                <option value="normal" ${
                  defaultFullMode === "normal" ? "selected" : ""
                }>Обычный</option>
                <option value="adv" ${
                  defaultFullMode === "adv" ? "selected" : ""
                }>Удачливый (полный переброс)</option>
                <option value="dis" ${
                  defaultFullMode === "dis" ? "selected" : ""
                }>Неудачливый (полный переброс)</option>
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
              callback: (dlg) =>
                resolve({
                  luck: clamp(num(dlg.find("input[name='luck']").val(), 0), 0, 20),
                  unluck: clamp(
                    num(dlg.find("input[name='unluck']").val(), 0),
                    0,
                    20
                  ),
                  fullMode: dlg.find("select[name='fullMode']").val(),
                }),
            },
            cancel: { label: "Отмена", callback: () => resolve(null) },
          },
          default: "roll",
          close: () => resolve(null),
        }).render(true);
      });

    // Persist active tab.
    html.find(".v-tabs__toggle").on("change", async (ev) => {
      const tab = ev.currentTarget.value;
      if (!tab) return;
      await this.actor.setFlag(scope, "activeTab", tab);
    });

    // Attribute increment with clamp and HP max update.
    html.find("[data-action='attr-inc']").on("click", async (ev) => {
      ev.preventDefault();
      const key = ev.currentTarget.dataset.attr;
      const attrs = this.actor.system.attributes ?? {};
      const current = clamp(num(attrs[key], 1), 1, 6);
      const next = clamp(current + 1, 1, 6);

      const patch = { [`system.attributes.${key}`]: next };

      if (key === "condition") {
        const newMaxHp = next * 8;
        patch["system.attributes.hp.max"] = newMaxHp;

        const curHp = clamp(
          num(this.actor.system.attributes?.hp?.value, newMaxHp),
          0,
          newMaxHp
        );
        if (curHp > newMaxHp) patch["system.attributes.hp.value"] = newMaxHp;
      }

      await this.actor.update(patch);
    });

    // Attribute decrement with clamp and HP max update.
    html.find("[data-action='attr-dec']").on("click", async (ev) => {
      ev.preventDefault();
      const key = ev.currentTarget.dataset.attr;
      const attrs = this.actor.system.attributes ?? {};
      const current = clamp(num(attrs[key], 1), 1, 6);
      const next = clamp(current - 1, 1, 6);

      const patch = { [`system.attributes.${key}`]: next };

      if (key === "condition") {
        const newMaxHp = next * 8;
        patch["system.attributes.hp.max"] = newMaxHp;

        const curHp = clamp(
          num(this.actor.system.attributes?.hp?.value, newMaxHp),
          0,
          newMaxHp
        );
        if (curHp > newMaxHp) patch["system.attributes.hp.value"] = newMaxHp;
      }

      await this.actor.update(patch);
    });

    // Attribute roll using global modifiers.
    html.find("[data-action='roll-attribute']").on("click", async (ev) => {
      ev.preventDefault();
      const btn = ev.currentTarget;
      const key = btn.dataset.attr;
      const label = btn.dataset.label ?? key;

      const attrs = this.actor.system.attributes ?? {};
    // Aggregate effects from items/abilities/states.
      const effectTotals = collectEffectTotals(this.actor);
      const globalMods = getGlobalRollModifiers(effectTotals);
      const pool = getEffectiveAttribute(attrs, key, effectTotals);

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
        label: `Проверка: ${label}`,
      });
    });

    // Inspiration increment with effects.
    html.find("[data-action='insp-inc']").on("click", async (ev) => {
      ev.preventDefault();

    // Inspiration: base max + effects.
      const insp = this.actor.system.attributes?.inspiration ?? {
        value: 6,
        max: 6,
      };
    // Aggregate effects from items/abilities/states.
      const effectTotals = collectEffectTotals(this.actor);
      const baseMax = clamp(num(insp.max, 6), 0, 99);
      const effMax = clamp(
        baseMax + getEffectValue(effectTotals, "inspMax"),
        0,
        99
      );
      const v = clamp(num(insp.value, 6), 0, effMax);
      const next = clamp(v + 1, 0, effMax);

      await this.actor.update({
        "system.attributes.inspiration.max": baseMax,
        "system.attributes.inspiration.value": next,
      });
    });

    // Inspiration decrement with effects.
    html.find("[data-action='insp-dec']").on("click", async (ev) => {
      ev.preventDefault();

    // Inspiration: base max + effects.
      const insp = this.actor.system.attributes?.inspiration ?? {
        value: 6,
        max: 6,
      };
    // Aggregate effects from items/abilities/states.
      const effectTotals = collectEffectTotals(this.actor);
      const baseMax = clamp(num(insp.max, 6), 0, 99);
      const effMax = clamp(
        baseMax + getEffectValue(effectTotals, "inspMax"),
        0,
        99
      );
      const v = clamp(num(insp.value, 6), 0, effMax);
      const next = clamp(v - 1, 0, effMax);

      await this.actor.update({
        "system.attributes.inspiration.max": baseMax,
        "system.attributes.inspiration.value": next,
      });
    });

    // Extra dice increment (flag).
    html.find("[data-action='extra-inc']").on("click", async (ev) => {
      ev.preventDefault();
      let cur = clamp(num(this.actor.getFlag(scope, "extraDice"), 2), 1, 20);
      cur = clamp(cur + 1, 1, 20);
      await this.actor.setFlag(scope, "extraDice", cur);
    });

    // Extra dice decrement (flag).
    html.find("[data-action='extra-dec']").on("click", async (ev) => {
      ev.preventDefault();
      let cur = clamp(num(this.actor.getFlag(scope, "extraDice"), 2), 1, 20);
      cur = clamp(cur - 1, 1, 20);
      await this.actor.setFlag(scope, "extraDice", cur);
    });

    // Extra dice roll.
    html.find("[data-action='extra-roll']").on("click", async (ev) => {
      ev.preventDefault();

      const cur = clamp(num(this.actor.getFlag(scope, "extraDice"), 2), 1, 20);
      const choice = await rollModeDialog("Доп. кубы");
      if (!choice) return;

    // Aggregate effects from items/abilities/states.
      const effectTotals = collectEffectTotals(this.actor);
      const globalMods = getGlobalRollModifiers(effectTotals);
      const rollLuck = choice.luck + globalMods.adv;
      const rollUnluck = choice.unluck + globalMods.dis;
      const rollFullMode =
        globalMods.fullMode !== "normal" ? globalMods.fullMode : choice.fullMode;

      await rollSuccessDice({
        pool: cur,
        actorName: this.actor.name,
        checkName: "Дополнительные кубы",
        luck: rollLuck,
        unluck: rollUnluck,
        fullMode: rollFullMode,
      });
    });

    // Luck roll (1 die).
    html.find("[data-action='luck-roll']").on("click", async (ev) => {
      ev.preventDefault();

      const choice = await rollModeDialog("Бросок удачи");
      if (!choice) return;

    // Aggregate effects from items/abilities/states.
      const effectTotals = collectEffectTotals(this.actor);
      const globalMods = getGlobalRollModifiers(effectTotals);
      const rollLuck = choice.luck + globalMods.adv;
      const rollUnluck = choice.unluck + globalMods.dis;
      const rollFullMode =
        globalMods.fullMode !== "normal" ? globalMods.fullMode : choice.fullMode;

      await rollSuccessDice({
        pool: 1,
        actorName: this.actor.name,
        checkName: "Бросок удачи",
        luck: rollLuck,
        unluck: rollUnluck,
        fullMode: rollFullMode,
      });
    });

    // Create inventory item.
    html.find("[data-action='create-item']").on("click", async (ev) => {
      ev.preventDefault();
      await this.actor.createEmbeddedDocuments("Item", [
        {
          name: "Новый предмет",
          type: "item",
          system: { description: "", quantity: 1, price: 0, effects: [] },
        },
      ]);
    });

    // Toggle equipped state.
    html.find("[data-action='toggle-equip']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item) return;
      const next = !item.system?.equipped;
      await item.update({ "system.equipped": next });
    });

    // Start weapon attack flow.
    html.find("[data-action='weapon-attack']").on("click", async (ev) => {
      ev.preventDefault();
      const weaponId = ev.currentTarget.dataset.itemId;
      const weapon = this.actor.items.get(weaponId);
      if (!weapon) return;
      await game.vitruvium.startWeaponAttackFlow(this.actor, weapon);
    });

    // Post item card to chat.
    html.find("[data-action='item-chat']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item) return;

      const desc = String(item.system?.description ?? "");
      const descHtml = desc
        ? esc(desc).replace(/\n/g, "<br>")
        : `<span class="hint">Описание не задано.</span>`;

      const isItem = item.type === "item";
      const qty = isItem ? Number(item.system?.quantity ?? 1) : null;
      const qtyText = isItem && Number.isFinite(qty) ? ` ×${qty}` : "";

      const img = item.img || "icons/svg/item-bag.svg";
      const typeLabel =
        item.type === "ability"
          ? "Способность"
          : item.type === "skill"
          ? "Навык"
          : item.type === "state"
          ? "Состояние"
          : "Предмет";

      const content = `
    <div class="vitruvium-chatcard v-itemcard">
      <div class="v-itemcard__top">
        <img class="v-itemcard__img" src="${esc(img)}" alt="${esc(item.name)}"/>
        <div class="v-itemcard__head">
          <div class="v-itemcard__title">${esc(item.name)}${qtyText}</div>
          <div class="v-itemcard__sub">${esc(this.actor.name)} · ${typeLabel}</div>
        </div>
      </div>
      <div class="v-itemcard__desc">${descHtml}</div>
    </div>
  `;

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content,
      });

      await playAutomatedAnimation({ actor: this.actor, item });
    });

    // Create ability.
    html.find("[data-action='create-ability']").on("click", async (ev) => {
      ev.preventDefault();
      await this.actor.createEmbeddedDocuments("Item", [
        {
          name: "Новая способность",
          type: "ability",
          system: { cost: 1, description: "", effects: [], active: false },
        },
      ]);
    });

    // Create skill.
    html.find("[data-action='create-skill']").on("click", async (ev) => {
      ev.preventDefault();
      await this.actor.createEmbeddedDocuments("Item", [
        { name: "Новый навык", type: "skill", system: { description: "", effects: [] } },
      ]);
    });

    // Create state.
    html.find("[data-action='create-state']").on("click", async (ev) => {
      ev.preventDefault();
      await this.actor.createEmbeddedDocuments("Item", [
        { name: "Новое состояние", type: "state", system: { description: "", effects: [] } },
      ]);
    });

    // Toggle ability active state.
    html.find("[data-action='toggle-ability-active']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item || item.type !== "ability") return;
      const next = !item.system?.active;
      await item.update({ "system.active": next });
    });

    // Open item sheet.
    html.find("[data-action='edit-item']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (item) item.sheet.render(true);
    });

    // Delete item (with confirmation).
    html.find("[data-action='delete-item']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item) return;

      const ok = await Dialog.confirm({
        title: "Удалить способность?",
        content: `<p>Удалить <b>${esc(item.name)}</b>?</p>`,
      });

      if (!ok) return;
      await this.actor.deleteEmbeddedDocuments("Item", [id]);
    });

    // Use ability: spend inspiration, then attack or chat.
    html.find("[data-action='use-ability']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item) return;

    // Resolve system data and attributes.
      const sys = item.system ?? {};
      const cost = Math.max(0, num(sys.cost, 0));
      const desc = String(sys.description ?? "");

      const damageBase = clamp(num(sys.rollDamageBase, 0), 0, 99);
      const damageDice = clamp(num(sys.rollDamageDice, 0), 0, 20);
      const saveBase = clamp(num(sys.rollSaveBase, 0), 0, 99);
      const saveDice = clamp(num(sys.rollSaveDice, 0), 0, 20);

      let useAsAttack = damageDice > 0 || saveDice > 0;
      if (!useAsAttack) {
        const legacyMode = String(sys.rollMode ?? "none");
        const legacyDice = clamp(num(sys.rollDice, 0), 0, 20);
        if (legacyMode === "damage" || legacyMode === "save") {
          useAsAttack = legacyDice > 0;
        }
      }
      if (!useAsAttack) {
        useAsAttack = damageBase > 0 || saveBase > 0;
      }

    // Inspiration: base max + effects.
      const insp = this.actor.system.attributes?.inspiration ?? {
        value: 0,
        max: 6,
      };
    // Aggregate effects from items/abilities/states.
      const effectTotals = collectEffectTotals(this.actor);
      const inspMax = clamp(
        num(insp.max, 6) + getEffectValue(effectTotals, "inspMax"),
        0,
        99
      );
      const inspValue = clamp(num(insp.value, 0), 0, inspMax);

      if (inspValue < cost) {
        ui.notifications?.warn(
          `Недостаточно вдохновения: нужно ${cost}, есть ${inspValue}`
        );
        return;
      }

      await this.actor.update({
        "system.attributes.inspiration.value": inspValue - cost,
      });

      if (useAsAttack) {
        await game.vitruvium.startAbilityAttackFlow(this.actor, item);
        return;
      }

      await playAutomatedAnimation({ actor: this.actor, item });
      const img = item.img ?? "icons/svg/mystery-man.svg";

      const content = `
        <div class="vitruvium-chatcard">
          <div class="vitruvium-chatcard__top">
            <img class="vitruvium-chatcard__img" src="${esc(img)}" title="${esc(
        item.name
      )}" />
            <div class="vitruvium-chatcard__head">
              <h3>${esc(item.name)}</h3>
              <p><b>Стоимость:</b> −${cost} вдохн.</p>
            </div>
          </div>
          ${
            desc
              ? `<p>${esc(desc).replace(/\n/g, "<br>")}</p>`
              : `<p class="hint">Описание не задано.</p>`
          }
        </div>
      `;

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content,
      });
    });

    const hpInput = html.find("input[name='system.attributes.hp.value']");
    if (hpInput.length) {
      let hpTimer = null;

      const computeMaxHp = () => {
        const attrs = this.actor.system.attributes ?? {};
    // Aggregate effects from items/abilities/states.
        const effectTotals = collectEffectTotals(this.actor);
    // HP max derived from condition + effects.
        const condition = getEffectiveAttribute(attrs, "condition", effectTotals);
        return Math.max(0, condition * 8 + getEffectValue(effectTotals, "hpMax"));
      };

      const normalizeHp = (raw) => {
        const hpMax = computeMaxHp();
        let v = num(raw, 0);
        v = Math.round(v);
        v = clamp(v, 0, hpMax);
        return v;
      };

      const saveHpNow = async () => {
        const v = normalizeHp(hpInput.val());
        const current = num(this.actor.system.attributes?.hp?.value, 0);
        if (v === current) return;
        await this.actor.update({ "system.attributes.hp.value": v });
      };

      const scheduleSave = () => {
        if (hpTimer) clearTimeout(hpTimer);
        hpTimer = setTimeout(() => {
          hpTimer = null;
          saveHpNow().catch(console.error);
        }, 150);
      };

      hpInput.on("input", scheduleSave);
      hpInput.on("change", scheduleSave);
      hpInput.on("blur", scheduleSave);

      hpInput.on("keydown", async (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        ev.stopPropagation();
        if (hpTimer) clearTimeout(hpTimer);
        hpTimer = null;
        await saveHpNow();
        hpInput.blur();
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
