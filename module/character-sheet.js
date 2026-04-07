import { clamp, toNumber } from "./utils/number.js";
import { escapeHtml } from "./utils/string.js";
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
import { replaceStateFromTemplate } from "./combat.js";
import { listSystemStateTemplates } from "./state-library.js";

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
      dragDrop: [{ dragSelector: ".v-inv__row", dropSelector: null }],
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

    const toRounds = (v, d = 0) => Math.max(0, Math.round(toNumber(v, d)));
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

    const expanded = this.actor.getFlag(
      game.system.id,
      "inventoryExpanded",
    ) ?? {
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
    const abiExpanded = this.actor.getFlag(
      game.system.id,
      "abilitiesExpanded",
    ) ?? {
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
    const abilities = (this.actor.items ?? []).filter(
      (i) => i.type === "ability",
    );
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
      (i) => i.type === "skill",
    );
    data.vitruvium.states = (this.actor.items ?? [])
      .filter((i) => i.type === "state")
      .map((state) => {
        const active = state.system?.active !== false;
        const turnDuration = toRounds(
          state.flags?.mySystem?.turnDuration,
          toRounds(state.system?.durationRounds, 0),
        );
        const remainingDefault = active ? turnDuration : 0;
        const remainingTurns = toRounds(
          state.flags?.mySystem?.remainingTurns,
          toRounds(state.system?.durationRemaining, remainingDefault),
        );
        const durationLabel =
          turnDuration > 0
            ? `${remainingTurns}/${turnDuration} х.`
            : "без длительности";
        return {
          _id: state.id,
          name: state.name,
          img: state.img,
          system: state.system ?? {},
          active,
          durationRounds: turnDuration,
          durationRemaining: remainingTurns,
          durationLabel,
        };
      });

    // Inspiration: base max + effects.
    const insp = attrs.inspiration ?? { value: 6, max: 6 };
    const inspMaxBase = clamp(toNumber(insp.max, 6), 0, 99);
    const inspMax = clamp(
      inspMaxBase + getEffectValue(effectTotals, "inspMax"),
      0,
      99,
    );
    const inspValue = clamp(toNumber(insp.value, inspMax), 0, inspMax);

    // HP max derived from condition + effects.
    const condition = getAttr("condition");
    const hpMax = Math.max(
      0,
      condition * 8 + getEffectValue(effectTotals, "hpMax"),
    );
    const hp = attrs.hp ?? { value: hpMax, max: hpMax };
    const hpValue = clamp(toNumber(hp.value, hpMax), 0, hpMax);

    // Flags scope (system id).
    const scope = game.system.id;
    const savedExtra = this.actor.getFlag(scope, "extraDice");
    const extraDice = clamp(toNumber(savedExtra, 2), 1, 20);

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
      bronze: Math.max(0, Math.round(toNumber(coins.bronze, 0))),
      silver: Math.max(0, Math.round(toNumber(coins.silver, 0))),
      gold: Math.max(0, Math.round(toNumber(coins.gold, 0))),
    };

    // Effective armor: base attribute + equipped items + active effects.
    const baseArmor = clamp(
      toNumber(
        this.actor.system?.attributes?.armor?.value ??
        this.actor.system?.attributes?.armor,
        0,
      ),
      0,
      999,
    );
    let bonusArmor = 0;
    const clamp6 = (n) => Math.min(Math.max(Number(n ?? 0), 0), 6);
    for (const it of this.actor.items) {
      if (it.type !== "item") continue;
      const sysItem = it.system ?? {};
      if (!sysItem.equipped) continue;
      bonusArmor += clamp6(sysItem.armorBonus);
    }
    data.vitruvium.armorTotal =
      baseArmor + bonusArmor + getEffectValue(effectTotals, "armorValue");

    // Speed = base + movement + effects.
    const mv = getAttr("movement");
    data.vitruvium.speed = 5 + mv + getEffectValue(effectTotals, "speed");

    return data;
  }

  async _updateObject(_event, formData) {
    // Remove tab selection from formData to keep it strictly local to this window
    // and avoid syncing it to other players via Actor updates.
    for (const key of Object.keys(formData)) {
      if (key.startsWith("v-tabs-")) delete formData[key];
    }

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

    const toRounds = (v, d = 0) => Math.max(0, Math.round(toNumber(v, d)));


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
                <option value="normal" ${defaultFullMode === "normal" ? "selected" : ""
            }>Обычный</option>
                <option value="adv" ${defaultFullMode === "adv" ? "selected" : ""
            }>Удачливый (полный переброс)</option>
                <option value="dis" ${defaultFullMode === "dis" ? "selected" : ""
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
                  luck: clamp(
                    toNumber(dlg.find("input[name='luck']").val(), 0),
                    0,
                    20,
                  ),
                  unluck: clamp(
                    toNumber(dlg.find("input[name='unluck']").val(), 0),
                    0,
                    20,
                  ),
                  extraDice: clamp(
                    toNumber(dlg.find("input[name='extraDice']").val(), 0),
                    -20,
                    20,
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
    html
      .find("input[name='system.attributes.level']")
      .on("change", async (ev) => {
        const v = Math.max(1, Math.round(toNumber(ev.currentTarget.value, 1)));
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
      const current = clamp(toNumber(attrs[key], 1), 1, 6);
      const next = clamp(current + 1, 1, 6);

      const patch = { [`system.attributes.${key}`]: next };

      if (key === "condition") {
        const newMaxHp = next * 8;
        patch["system.attributes.hp.max"] = newMaxHp;

        const curHp = clamp(
          toNumber(this.actor.system.attributes?.hp?.value, newMaxHp),
          0,
          newMaxHp,
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
      const current = clamp(toNumber(attrs[key], 1), 1, 6);
      const next = clamp(current - 1, 1, 6);

      const patch = { [`system.attributes.${key}`]: next };

      if (key === "condition") {
        const newMaxHp = next * 8;
        patch["system.attributes.hp.max"] = newMaxHp;

        const curHp = clamp(
          toNumber(this.actor.system.attributes?.hp?.value, newMaxHp),
          0,
          newMaxHp,
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
      const pool = clamp(
        basePool + attrMods.dice + globalMods.dice + toNumber(choice.extraDice, 0),
        1,
        20,
      );

      const rollLuck = choice.luck + globalMods.adv + attrMods.adv;
      const rollUnluck = choice.unluck + globalMods.dis + attrMods.dis;
      const rollFullMode =
        globalMods.fullMode !== "normal"
          ? globalMods.fullMode
          : choice.fullMode;

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
      const baseMax = clamp(toNumber(insp.max, 6), 0, 99);
      const effMax = clamp(
        baseMax + getEffectValue(effectTotals, "inspMax"),
        0,
        99,
      );
      const v = clamp(toNumber(insp.value, 6), 0, effMax);
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
      const baseMax = clamp(toNumber(insp.max, 6), 0, 99);
      const effMax = clamp(
        baseMax + getEffectValue(effectTotals, "inspMax"),
        0,
        99,
      );
      const v = clamp(toNumber(insp.value, 6), 0, effMax);
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
      const condition = clamp(toNumber(attrs.condition, 1), 1, 6);
      const hpMax = condition * 8 + getEffectValue(effectTotals, "hpMax");

      // Inspiration max = base max + inspMax effect.
      const insp = attrs.inspiration ?? { value: 6, max: 6 };
      const baseInspMax = clamp(toNumber(insp.max, 6), 0, 99);
      const inspMax = clamp(
        baseInspMax + getEffectValue(effectTotals, "inspMax"),
        0,
        99,
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
      let cur = clamp(toNumber(this.actor.getFlag(scope, "extraDice"), 2), 1, 20);
      cur = clamp(cur + 1, 1, 20);
      await this.actor.setFlag(scope, "extraDice", cur);
    });

    // Extra dice decrement (flag).
    html.find("[data-action='extra-dec']").on("click", async (ev) => {
      ev.preventDefault();
      let cur = clamp(toNumber(this.actor.getFlag(scope, "extraDice"), 2), 1, 20);
      cur = clamp(cur - 1, 1, 20);
      await this.actor.setFlag(scope, "extraDice", cur);
    });

    // Extra dice roll.
    html.find("[data-action='extra-roll']").on("click", async (ev) => {
      ev.preventDefault();

      const cur = clamp(toNumber(this.actor.getFlag(scope, "extraDice"), 2), 1, 20);
      const choice = await rollModeDialog("Доп. кубы");
      if (!choice) return;

      // Aggregate effects from items/abilities/states.
      const effectTotals = collectEffectTotals(this.actor);
      const globalMods = getGlobalRollModifiers(effectTotals);

      const pool = clamp(cur + globalMods.dice + toNumber(choice.extraDice, 0), 1, 20);
      const rollLuck = choice.luck + globalMods.adv;
      const rollUnluck = choice.unluck + globalMods.dis;
      const rollFullMode =
        globalMods.fullMode !== "normal"
          ? globalMods.fullMode
          : choice.fullMode;

      await rollSuccessDice({
        pool,
        actorName: this.actor.name,
        checkName: "Дополнительные кубы",
        luck: rollLuck,
        unluck: rollUnluck,
        fullMode: rollFullMode,
      });
    });

    // Luck roll (1 die, ignore modifiers).
    html.find("[data-action='luck-roll']").on("click", async (ev) => {
      ev.preventDefault();

      const choice = await rollModeDialog("Бросок удачи");
      if (!choice) return;

      await rollSuccessDice({
        pool: 1,
        actorName: this.actor.name,
        checkName: "Бросок удачи",
        luck: choice.luck,
        unluck: choice.unluck,
        fullMode: choice.fullMode,
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
        ? escapeHtml(desc).replace(/\n/g, "<br>")
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
        <img class="v-itemcard__img" src="${escapeHtml(img)}" alt="${escapeHtml(item.name)}"/>
        <div class="v-itemcard__head">
          <div class="v-itemcard__title">@UUID[${item.uuid}]{${escapeHtml(item.name)}}${qtyText}</div>
          <div class="v-itemcard__sub">${escapeHtml(this.actor.name)} · ${typeLabel}</div>
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
            contestStates: [
              {
                uuid: "",
                durationRounds: 1,
                applyMode: "targetContest",
                casterAttr: "combat",
                targetAttr: "combat",
              },
            ],
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
        {
          name: "Новый навык",
          type: "skill",
          system: { description: "", effects: [] },
        },
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
    html
      .find("[data-action='toggle-ability-active']")
      .on("click", async (ev) => {
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
      const turnDuration = toRounds(
        item.flags?.mySystem?.turnDuration,
        toRounds(item.system?.durationRounds, 0),
      );
      await item.update({
        "system.active": next,
        "system.durationRounds": turnDuration,
        "system.durationRemaining": next ? turnDuration : 0,
        "flags.mySystem.turnDuration": turnDuration,
        "flags.mySystem.remainingTurns": next ? turnDuration : 0,
        "flags.mySystem.ownerActorId": item.actor?.id ?? "",
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
        const expanded =
          this.actor.getFlag(game.system.id, "abilitiesExpanded") ?? {};
        await this.actor.setFlag(game.system.id, "abilitiesExpanded", {
          ...expanded,
          [abiKey]: expanded[abiKey] === false,
        });
      } else {
        const expanded =
          this.actor.getFlag(game.system.id, "inventoryExpanded") ?? {};
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
        content: `<p>Удалить <b>${escapeHtml(item.name)}</b>?</p>`,
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
      const cost = Math.max(0, toNumber(sys.cost, 0));
      const desc = String(sys.description ?? "");

      const damageBase = clamp(toNumber(sys.rollDamageBase, 0), 0, 99);
      const healBase = clamp(toNumber(sys.rollHealBase, 0), 0, 99);
      const attackRollEnabled = sys.attackRoll === true;

      // Normalize contestStates array - support both old and new format
      let contestStates = Array.isArray(sys.contestStates)
        ? sys.contestStates
        : [];
      if (contestStates.length === 0) {
        const oldUuid = String(sys.contestStateUuid ?? "").trim();
        const oldDuration = Math.max(
          0,
          Math.round(toNumber(sys.contestStateDurationRounds, 1)),
        );
        const oldMode = [
          "self",
          "targetNoCheck",
          "targetContest",
          "CRIT_ATTACK",
        ].includes(
          sys.contestApplyMode,
        )
          ? sys.contestApplyMode
          : "targetContest";
        if (oldUuid) {
          contestStates = [
            { uuid: oldUuid, durationRounds: oldDuration, applyMode: oldMode },
          ];
        }
      }
      contestStates = contestStates
        .filter((s) => String(s.uuid ?? "").trim().length > 0)
        .map((s) => ({
          uuid: String(s.uuid ?? "").trim(),
          durationRounds: Math.max(
            0,
            Math.round(Number(s.durationRounds ?? 1)),
          ),
          applyMode: [
            "self",
            "targetNoCheck",
            "targetContest",
            "CRIT_ATTACK",
          ].includes(
            s.applyMode,
          )
            ? s.applyMode
            : "targetContest",
        }));

      const hasContestStates = contestStates.length > 0;
      const selfStates = contestStates.filter((s) => s.applyMode === "self");
      const nonSelfStates = contestStates.filter((s) => s.applyMode !== "self");
      const useAsAttack =
        (damageBase > 0 || healBase > 0) ||
        (hasContestStates && nonSelfStates.length > 0);

      // Inspiration: base max + effects.
      const insp = this.actor.system.attributes?.inspiration ?? {
        value: 0,
        max: 6,
      };
      // Aggregate effects from items/abilities/states.
      const effectTotals = collectEffectTotals(this.actor);
      const inspMax = clamp(
        toNumber(insp.max, 6) + getEffectValue(effectTotals, "inspMax"),
        0,
        99,
      );
      const inspValue = clamp(toNumber(insp.value, 0), 0, inspMax);

      if (inspValue < cost) {
        ui.notifications?.warn(
          `Недостаточно вдохновения: нужно ${cost}, есть ${inspValue}`,
        );
        return;
      }

      await this.actor.update({
        "system.attributes.inspiration.value": inspValue - cost,
      });

      // For "self" mode states, apply to caster immediately.
      if (selfStates.length > 0) {
        const appliedStates = [];
        for (const state of selfStates) {
          const out = await replaceStateFromTemplate(
            this.actor,
            state.uuid,
            state.durationRounds,
          );
          if (out.applied) {
            appliedStates.push(out.stateName ?? "Состояние");
          }
        }

        // If only "self" states and no damage/heal, post chat card and return
        if (nonSelfStates.length === 0 && !damageBase && !healBase) {
          await playAutomatedAnimation({ actor: this.actor, item });
          const img = item.img ?? "icons/svg/mystery-man.svg";
          const stateLines = appliedStates
            .map((name) => `<p>✓ Накладывает: <b>${escapeHtml(name)}</b></p>`)
            .join("");
          const content = `
            <div class="vitruvium-chatcard">
              <div class="vitruvium-chatcard__top">
                <img class="vitruvium-chatcard__img" src="${escapeHtml(img)}" title="${escapeHtml(item.name)}" />
                <div class="vitruvium-chatcard__head">
                  <h3>${escapeHtml(item.name)}</h3>
                  <p>${escapeHtml(this.actor.name)} использует способность</p>
                </div>
              </div>
              ${stateLines}
              ${desc ? `<div class="vitruvium-chatcard__desc">${escapeHtml(desc).replace(/\n/g, "<br>")}</div>` : ""}
            </div>
          `;
          await ChatMessage.create({
            ...chatVisibilityData(),
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content,
          });
          return;
        }
      }

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
          getEffectValue(effectTotals, "hpMax"),
        );
        const hpCur = clamp(toNumber(hp.value, hpMax), 0, hpMax);
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
            <img class="vitruvium-chatcard__img" src="${escapeHtml(img)}" title="${escapeHtml(
        item.name,
      )}" />
            <div class="vitruvium-chatcard__head">
              <h3>${escapeHtml(item.name)}</h3>
              <p><b>Стоимость:</b> −${cost} вдохн.</p>
            </div>
          </div>
          ${effectLines}
          ${desc
          ? `<p>${escapeHtml(desc).replace(/\n/g, "<br>")}</p>`
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
        const condition = getEffectiveAttribute(
          attrs,
          "condition",
          effectTotals,
        );
        return Math.max(
          0,
          condition * 8 + getEffectValue(effectTotals, "hpMax"),
        );
      };

      const normalizeHp = (raw) => {
        const hpMax = computeMaxHp();
        let v = toNumber(raw, 0);
        v = Math.round(v);
        v = clamp(v, 0, hpMax);
        return v;
      };

      const saveHpNow = async () => {
        const v = normalizeHp(hpInput.val());
        const current = toNumber(this.actor.system.attributes?.hp?.value, 0);
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
          const input = html.find(
            `input[name='system.attributes.coins.${field}']`,
          );
          next[field] = normalizeCoin(input.val());
        }
        return next;
      };

      const saveCoinsNow = async () => {
        const current = this.actor.system.attributes?.coins ?? {};
        const next = getCoinsFromInputs();
        const bronzeNow = toNumber(current.bronze, 0);
        const silverNow = toNumber(current.silver, 0);
        const goldNow = toNumber(current.gold, 0);
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
