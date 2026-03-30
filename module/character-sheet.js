import { rollSuccessDice } from "./rolls.js";
import {
  collectEffectTotals,
  getEffectValue,
  getEffectiveAttribute,
  getAttributeRollModifiers,
  getGlobalRollModifiers,
} from "./effects.js";
import { playAutomatedAnimation } from "./auto-animations.js";
import { chatVisibilityData } from "./chat-visibility.js";

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
    const toRounds = (v, d = 0) => Math.max(0, Math.round(num(v, d)));
    // Attribute getter with effects applied.
    const getAttr = (k) => getEffectiveAttribute(attrs, k, effectTotals);

    data.vitruvium = data.vitruvium ?? {};
    const items = this.actor.items.filter((i) => i.type === "item");
    const categoryLabels = {
      weapon: "Оружие",
      equipment: "Снаряжение",
      consumables: "Расходники",
      trinkets: "Безделушки",
      tools: "Инструменты",
      loot: "Добыча",
    };

    const expanded = this.actor.getFlag(game.system.id, "inventoryExpanded") ?? {
      weapon: true,
      equipment: true,
      consumables: true,
      trinkets: true,
      tools: true,
      loot: true,
    };

    const grouped = {};
    for (const [key, label] of Object.entries(categoryLabels)) {
      grouped[key] = {
        key,
        label,
        items: [],
        expanded: expanded[key] !== false,
      };
    }

    for (const item of items) {
      const type = item.system.type || "equipment";
      if (grouped[type]) {
        grouped[type].items.push(item);
      } else {
        grouped.equipment.items.push(item);
      }
    }
    data.vitruvium.inventory = Object.values(grouped);
    data.vitruvium.items = items;

    // Group abilities by type (primary / secondary / other).
    const abilityCategoryLabels = {
      primary: "Основные",
      secondary: "Вторичные",
      other: "Остальные",
    };
    const abiExpanded = this.actor.getFlag(game.system.id, "abilitiesExpanded") ?? {
      primary: true,
      secondary: true,
      other: true,
    };
    const abiGrouped = {};
    for (const [key, label] of Object.entries(abilityCategoryLabels)) {
      abiGrouped[key] = {
        key,
        label,
        items: [],
        expanded: abiExpanded[key] !== false,
      };
    }
    const abilities = (this.actor.items ?? []).filter((i) => i.type === "ability");
    for (const ab of abilities) {
      const type = ab.system.type || "primary";
      if (abiGrouped[type]) {
        abiGrouped[type].items.push(ab);
      } else {
        abiGrouped.primary.items.push(ab);
      }
    }
    data.vitruvium.abilities = Object.values(abiGrouped);
    data.vitruvium.skills = (this.actor.items ?? []).filter(
      (i) => i.type === "skill"
    );
    data.vitruvium.states = (this.actor.items ?? [])
      .filter((i) => i.type === "state")
      .map((state) => {
        const active = state.system?.active !== false;
        const durationRounds = toRounds(state.system?.durationRounds, 0);
        const remainingDefault = active ? durationRounds : 0;
        const durationRemaining = toRounds(
          state.system?.durationRemaining,
          remainingDefault
        );
        const durationLabel =
          durationRounds > 0
            ? `${durationRemaining}/${durationRounds} р.`
            : "без длительности";
        return {
          _id: state.id,
          name: state.name,
          img: state.img,
          system: state.system ?? {},
          active,
          durationRounds,
          durationRemaining,
          durationLabel,
        };
      });

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

    // Active tab is local to this sheet window (not shared via actor flags).
    const savedTab = String(this._activeTab ?? "inv");
    data.vitruvium.activeTab =
      savedTab === "abi" || savedTab === "skill" || savedTab === "state"
        ? savedTab
        : "inv";
    const tabBase = `v-tabs-${this.appId ?? this.actor?.id ?? "actor"}`;
    data.vitruvium.tabName = tabBase;
    data.vitruvium.tabIds = {
      inv: `${tabBase}-inv`,
      abi: `${tabBase}-abi`,
      skill: `${tabBase}-skill`,
      state: `${tabBase}-state`,
    };

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
    const coins =
      this.actor.system.attributes?.coins ?? data.system.attributes.coins ?? {};
    data.system.attributes.coins = {
      bronze: Math.max(0, Math.round(num(coins.bronze, 0))),
      silver: Math.max(0, Math.round(num(coins.silver, 0))),
      gold: Math.max(0, Math.round(num(coins.gold, 0))),
    };

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

  async _updateObject(_event, formData) {
    for (const key of ["bronze", "silver", "gold"]) {
      const path = `system.attributes.coins.${key}`;
      if (!(path in formData)) continue;

      const raw = formData[path];
      if (raw === "" || raw === null || raw === undefined) {
        formData[path] = 0;
        continue;
      }

      const parsed = Number(raw);
      formData[path] = Number.isFinite(parsed)
        ? Math.max(0, Math.round(parsed))
        : 0;
    }

    return this.actor.update(formData);
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Local helpers.
    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };
    const toRounds = (v, d = 0) => Math.max(0, Math.round(num(v, d)));
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
        const defaultExtraDice = 0;
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
            <label>Доп. кубы (можно отрицательное)
              <input type="number" name="extraDice" value="${defaultExtraDice}" min="-20" max="20" step="1" style="width:100%"/>
            </label>
            <div style="font-size:12px; opacity:.75;">Положительное число увеличивает пул кубов, отрицательное уменьшает.</div>
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
                  extraDice: clamp(
                    num(dlg.find("input[name='extraDice']").val(), 0),
                    -20,
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

    // Immediate save for actor name on change.
    html.find("input[name='name']").on("change", async (ev) => {
      const v = String(ev.currentTarget.value ?? this.actor.name);
      if (v && v !== this.actor.name) await this.actor.update({ name: v });
    });

    // Immediate save for level on change.
    html.find("input[name='system.attributes.level']").on("change", async (ev) => {
      const v = Math.max(1, Math.round(num(ev.currentTarget.value, 1)));
      await this.actor.update({ "system.attributes.level": v });
    });

    // Keep active tab local to this window.
    html.find(".v-tabs__toggle").on("change", (ev) => {
      const tab = ev.currentTarget.value;
      if (!tab) return;
      this._activeTab = String(tab);
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
      const attrMods = getAttributeRollModifiers(effectTotals, key);
      const basePool = getEffectiveAttribute(attrs, key, effectTotals);

      const choice = await rollModeDialog(`Проверка: ${label}`);
      if (!choice) return;
      const pool = clamp(basePool + attrMods.dice + num(choice.extraDice, 0), 1, 20);

      const rollLuck = choice.luck + globalMods.adv + attrMods.adv;
      const rollUnluck = choice.unluck + globalMods.dis + attrMods.dis;
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

    // Long rest: fully restore HP and inspiration.
    html.find("[data-action='long-rest']").on("click", async (ev) => {
      ev.preventDefault();

      const attrs = this.actor.system.attributes ?? {};
      const effectTotals = collectEffectTotals(this.actor);

      // HP max = condition * 8 + hpMax effect.
      const condition = clamp(num(attrs.condition, 1), 1, 6);
      const hpMax = condition * 8 + getEffectValue(effectTotals, "hpMax");

      // Inspiration max = base max + inspMax effect.
      const insp = attrs.inspiration ?? { value: 6, max: 6 };
      const baseInspMax = clamp(num(insp.max, 6), 0, 99);
      const inspMax = clamp(
        baseInspMax + getEffectValue(effectTotals, "inspMax"),
        0,
        99
      );

      await this.actor.update({
        "system.attributes.hp.value": hpMax,
        "system.attributes.hp.max": hpMax,
        "system.attributes.inspiration.value": inspMax,
        "system.attributes.inspiration.max": baseInspMax,
      });

      ChatMessage.create({
        content: `<strong>${this.actor.name}</strong> завершает долгий отдых и полностью восстанавливает силы.`,
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
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
      const pool = clamp(cur + num(choice.extraDice, 0), 1, 20);

    // Aggregate effects from items/abilities/states.
      const effectTotals = collectEffectTotals(this.actor);
      const globalMods = getGlobalRollModifiers(effectTotals);
      const rollLuck = choice.luck + globalMods.adv;
      const rollUnluck = choice.unluck + globalMods.dis;
      const rollFullMode =
        globalMods.fullMode !== "normal" ? globalMods.fullMode : choice.fullMode;

      await rollSuccessDice({
        pool,
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
      const pool = clamp(1 + num(choice.extraDice, 0), 1, 20);

    // Aggregate effects from items/abilities/states.
      const effectTotals = collectEffectTotals(this.actor);
      const globalMods = getGlobalRollModifiers(effectTotals);
      const rollLuck = choice.luck + globalMods.adv;
      const rollUnluck = choice.unluck + globalMods.dis;
      const rollFullMode =
        globalMods.fullMode !== "normal" ? globalMods.fullMode : choice.fullMode;

      await rollSuccessDice({
        pool,
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
          system: {
            description: "",
            quantity: 1,
            price: 0,
            canBlock: false,
            effects: [],
          },
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
        ...chatVisibilityData(),
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
          system: {
            cost: 1,
            actions: 1,
            active: false,
            attackRoll: false,
            attackAttr: "combat",
            rollDamageBase: 0,
            rollHealBase: 0,
            contestStateUuid: "",
            contestStateDurationRounds: 1,
            contestCasterAttr: "combat",
            contestTargetAttr: "combat",
            description: "",
            effects: [],
          },
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
        {
          name: "Новое состояние",
          type: "state",
          system: {
            active: true,
            durationRounds: 0,
            durationRemaining: 0,
            description: "",
            effects: [],
          },
        },
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

    // Toggle state active flag and reset round timer when enabled.
    html.find("[data-action='toggle-state-active']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item || item.type !== "state") return;
      const currentlyActive = item.system?.active !== false;
      const next = !currentlyActive;
      const durationRounds = toRounds(item.system?.durationRounds, 0);
      await item.update({
        "system.active": next,
        "system.durationRemaining": next ? durationRounds : 0,
      });
    });
    // Open item sheet.
    html.find("[data-action='edit-item']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (item) item.sheet.render(true);
    });

    // Toggle inventory / ability folder.
    html.find("[data-action='toggle-folder']").on("click", async (ev) => {
      ev.preventDefault();
      const folderKey = ev.currentTarget.dataset.folder;
      if (folderKey.startsWith("abi-")) {
        const abiKey = folderKey.slice(4);
        const expanded = this.actor.getFlag(game.system.id, "abilitiesExpanded") ?? {};
        await this.actor.setFlag(game.system.id, "abilitiesExpanded", {
          ...expanded,
          [abiKey]: expanded[abiKey] === false,
        });
      } else {
        const expanded = this.actor.getFlag(game.system.id, "inventoryExpanded") ?? {};
        const next = expanded[folderKey] === false;
        await this.actor.setFlag(game.system.id, "inventoryExpanded", {
          ...expanded,
          [folderKey]: next,
        });
      }
    });

    // Delete item (with confirmation).
    html.find("[data-action='delete-item']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item) return;

      const ok = await Dialog.confirm({
        title: `Удалить ${item.type === "ability" ? "способность" : "предмет"}?`,
        content: `<p>Удалить <b>${esc(item.name)}</b>?</p>`,
      });

      if (!ok) return;
      await this.actor.deleteEmbeddedDocuments("Item", [id]);
    });

    // Use ability: spend inspiration, then attack or apply non-attack effects.
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
      const healBase = clamp(num(sys.rollHealBase, 0), 0, 99);
      const attackRollEnabled = sys.attackRoll === true;
      const hasContestState = String(sys.contestStateUuid ?? "").trim().length > 0;
      const useAsAttack =
        (attackRollEnabled && (damageBase > 0 || healBase > 0)) ||
        hasContestState;

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

      let actualHeal = 0;
      if (healBase > 0) {
        const attrs = this.actor.system.attributes ?? {};
        const hp = attrs.hp ?? {};
        const hpMax = Math.max(
          0,
          getEffectiveAttribute(attrs, "condition", effectTotals) * 8 +
            getEffectValue(effectTotals, "hpMax")
        );
        const hpCur = clamp(num(hp.value, hpMax), 0, hpMax);
        const hpNext = clamp(hpCur + healBase, 0, hpMax);
        actualHeal = Math.max(0, hpNext - hpCur);
        if (hpNext !== hpCur) {
          await this.actor.update({
            "system.attributes.hp.value": hpNext,
          });
        }
      }

      await playAutomatedAnimation({ actor: this.actor, item });
      const img = item.img ?? "icons/svg/mystery-man.svg";
      const effectLines = [
        damageBase > 0 ? `<p><b>Урон:</b> ${damageBase}</p>` : "",
        healBase > 0
          ? `<p><b>Хил:</b> +${healBase}${actualHeal !== healBase ? ` (факт: +${actualHeal})` : ""}</p>`
          : "",
      ]
        .filter(Boolean)
        .join("");

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
          ${effectLines}
          ${
            desc
              ? `<p>${esc(desc).replace(/\n/g, "<br>")}</p>`
              : `<p class="hint">Описание не задано.</p>`
          }
        </div>
      `;

      await ChatMessage.create({
        ...chatVisibilityData(),
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

    const coinFields = ["bronze", "silver", "gold"];
    const coinInputs = html.find(".v-coin__input");
    if (coinInputs.length) {
      const normalizeCoin = (raw) => {
        if (raw === "" || raw === null || raw === undefined) return 0;
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return 0;
        return Math.max(0, Math.round(parsed));
      };

      const getCoinsFromInputs = () => {
        const next = {};
        for (const field of coinFields) {
          const input = html.find(`input[name='system.attributes.coins.${field}']`);
          next[field] = normalizeCoin(input.val());
        }
        return next;
      };

      const saveCoinsNow = async () => {
        const current = this.actor.system.attributes?.coins ?? {};
        const next = getCoinsFromInputs();
        const bronzeNow = num(current.bronze, 0);
        const silverNow = num(current.silver, 0);
        const goldNow = num(current.gold, 0);
        if (
          next.bronze === bronzeNow &&
          next.silver === silverNow &&
          next.gold === goldNow
        ) {
          return;
        }
        await this.actor.update({
          "system.attributes.coins.bronze": next.bronze,
          "system.attributes.coins.silver": next.silver,
          "system.attributes.coins.gold": next.gold,
        });
      };

      coinInputs.on("change", () => saveCoinsNow().catch(console.error));
      coinInputs.on("blur", () => saveCoinsNow().catch(console.error));

      coinInputs.on("keydown", async (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        ev.stopPropagation();
        await saveCoinsNow();
        ev.currentTarget.blur();
      });
    }
  }
}
