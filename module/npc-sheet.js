import {
  collectEffectTotals,
  getEffectValue,
  getAttributeRollModifiers,
  getGlobalRollModifiers,
  getEffectiveAttribute,
} from "./effects.js";
import { rollSuccessDice } from "./rolls.js";
import { chatVisibilityData } from "./chat-visibility.js";
import { playAutomatedAnimation } from "./auto-animations.js";

export class VitruviumNPCSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "actor", "npc"],
      template: "systems/Vitruvium/templates/actor/npc-sheet.hbs",
      width: 640,
      height: 640,
      submitOnChange: false,
      submitOnClose: true,
      dragDrop: [{ dragSelector: ".v-inv__row", dropSelector: null }],
    });
  }

  getData() {
    const data = super.getData();

    const sys = data.system ?? this.actor.system ?? {};
    const attrs = sys.attributes ?? {};
    const effectTotals = collectEffectTotals(this.actor);

    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };
    const toRounds = (v, d = 0) => Math.max(0, Math.round(num(v, d)));

    const getAttr = (k) => getEffectiveAttribute(attrs, k, effectTotals);

    data.vitruvium = data.vitruvium ?? {};
    data.vitruvium.items = this.actor.items.filter((i) => i.type === "item");
    data.vitruvium.abilities = (this.actor.items ?? []).filter(
      (i) => i.type === "ability",
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
        const durationRemaining = toRounds(
          state.flags?.mySystem?.remainingTurns,
          toRounds(state.system?.durationRemaining, remainingDefault),
        );
        const durationLabel =
          turnDuration > 0
            ? `${durationRemaining}/${turnDuration} х.`
            : "без длительности";
        return {
          _id: state.id,
          name: state.name,
          img: state.img,
          system: state.system ?? {},
          active,
          durationLabel,
        };
      });

    const savedTab = String(this._activeTab ?? "inv");
    data.vitruvium.activeTab =
      savedTab === "abi" || savedTab === "state" ? savedTab : "inv";
    const tabBase = `v-tabs-${this.appId ?? this.actor?.id ?? "actor"}`;
    data.vitruvium.tabName = tabBase;
    data.vitruvium.tabIds = {
      inv: `${tabBase}-inv`,
      abi: `${tabBase}-abi`,
      state: `${tabBase}-state`,
    };

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
    data.vitruvium.attributes = allowed.map((key) => ({
      key,
      label: attrLabels[key] ?? key,
      value: getAttr(key),
    }));

    const insp = attrs.inspiration ?? { value: 6, max: 6 };
    const inspMaxBase = clamp(num(insp.max, 6), 0, 99);
    const inspMax = clamp(
      inspMaxBase + getEffectValue(effectTotals, "inspMax"),
      0,
      99,
    );
    const inspValue = clamp(num(insp.value, inspMax), 0, inspMax);
    data.vitruvium.inspiration = { value: inspValue, max: inspMax };

    // HP - читаем напрямую из actor, не вычисляем
    const hp = attrs.hp ?? { value: 0, max: 0 };
    const hpMax = clamp(num(hp.max, 0), 0, 999);
    const hpValue = clamp(num(hp.value, 0), 0, 999);
    data.vitruvium.hp = { value: hpValue, max: hpMax };

    // Сохраняем для шаблона
    data.system = data.system || {};
    data.system.attributes = data.system.attributes || {};
    data.system.attributes.hp = { value: hpValue, max: hpMax };

    const scope = game.system.id;
    const savedExtra = this.actor.getFlag(scope, "extraDice");
    data.vitruvium.extraDice = clamp(num(savedExtra, 2), 1, 20);

    // Armor - читаем напрямую
    const armor = attrs.armor ?? { value: 0 };
    const armorValue = clamp(num(armor.value, 0), 0, 999);
    data.vitruvium.armor = { value: armorValue };
    data.system.attributes.armor = { value: armorValue };

    // Speed - читаем напрямую (не вычисляем из movement)
    const speed = attrs.speed ?? { value: 0 };
    const speedValue = clamp(num(speed.value, 0), 0, 999);
    data.vitruvium.speed = { value: speedValue };
    data.system.attributes.speed = { value: speedValue };

    return data;
  }

  async _updateObject(_event, formData) {
    // Remove tab selection from formData to keep it strictly local to this window
    // and avoid syncing it to other players via Actor updates.
    for (const key of Object.keys(formData)) {
      if (key.startsWith("v-tabs-")) delete formData[key];
    }

    // Обработка пустых значений для HP
    for (const key of ["hp.value", "hp.max"]) {
      const path = `system.attributes.${key}`;
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

    // Обработка пустых значений для armor и speed
    for (const key of ["armor.value", "speed.value"]) {
      const path = `system.attributes.${key}`;
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

    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };

    const esc = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const scope = game.system.id;

    // Roll mode dialog
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
            <label>Доп. кубы (можно отрицательное)
              <input type="number" name="extraDice" value="${defaultExtraDice}" min="-20" max="20" step="1" style="width:100%"/>
            </label>
            <div style="font-size:12px; opacity:.75;">Положительное число увеличивает пул кубов, отрицательное уменьшает.</div>
            <div style="font-size:12px; opacity:.75;">Каждый счетчик преимущества/помехи перебрасывает один куб. Удачливый/неудачливый бросок игнорирует счетчики.</div>
          </div>`,
          buttons: {
            roll: {
              label: "Бросить",
              callback: (html) =>
                resolve({
                  luck: clamp(
                    num(html.find("input[name='luck']").val(), 0),
                    0,
                    20,
                  ),
                  unluck: clamp(
                    num(html.find("input[name='unluck']").val(), 0),
                    0,
                    20,
                  ),
                  extraDice: clamp(
                    num(html.find("input[name='extraDice']").val(), 0),
                    -20,
                    20,
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

    // Name change
    html.find("input[name='name']").on("change", async (ev) => {
      const v = String(ev.currentTarget.value ?? this.actor.name);
      if (v && v !== this.actor.name) await this.actor.update({ name: v });
    });

    // Attribute +/-
    html.find("[data-action='attr-inc']").on("click", async (ev) => {
      ev.preventDefault();
      const key = ev.currentTarget.dataset.attr;
      const attrs = this.actor.system.attributes ?? {};
      const current = num(attrs[key]?.value ?? 0, 0);
      const next = clamp(current + 1, 0, 99);
      await this.actor.update({ [`system.attributes.${key}.value`]: next });
    });

    html.find("[data-action='attr-dec']").on("click", async (ev) => {
      ev.preventDefault();
      const key = ev.currentTarget.dataset.attr;
      const attrs = this.actor.system.attributes ?? {};
      const current = num(attrs[key]?.value ?? 0, 0);
      const next = clamp(current - 1, 0, 99);
      await this.actor.update({ [`system.attributes.${key}.value`]: next });
    });

    // Attribute roll
    html.find("[data-action='roll-attribute']").on("click", async (ev) => {
      ev.preventDefault();
      const btn = ev.currentTarget;
      const key = btn.dataset.attr;
      const label = btn.dataset.label ?? key;
      const attrs = this.actor.system.attributes ?? {};
      const effectTotals = collectEffectTotals(this.actor);
      const globalMods = getGlobalRollModifiers(effectTotals);
      const attrMods = getAttributeRollModifiers(effectTotals, key);
      const base = num(attrs[key]?.value ?? 0, 0);
      const choice = await rollModeDialog(`Проверка: ${label}`);
      if (!choice) return;
      const pool = clamp(
        getEffectiveAttribute(attrs, key, effectTotals) +
          attrMods.dice +
          globalMods.dice +
          num(choice.extraDice, 0),
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
      });
    });

    // Inspiration +/-
    html.find("[data-action='insp-inc']").on("click", async (ev) => {
      ev.preventDefault();
      const insp = this.actor.system.attributes?.inspiration ?? {
        value: 6,
        max: 6,
      };
      const effectTotals = collectEffectTotals(this.actor);
      const baseMax = clamp(num(insp.max, 6), 0, 99);
      const effMax = clamp(
        baseMax + getEffectValue(effectTotals, "inspMax"),
        0,
        99,
      );
      const v = clamp(num(insp.value, 6), 0, effMax);
      const next = clamp(v + 1, 0, effMax);
      await this.actor.update({
        "system.attributes.inspiration.max": baseMax,
        "system.attributes.inspiration.value": next,
      });
    });

    html.find("[data-action='insp-dec']").on("click", async (ev) => {
      ev.preventDefault();
      const insp = this.actor.system.attributes?.inspiration ?? {
        value: 6,
        max: 6,
      };
      const effectTotals = collectEffectTotals(this.actor);
      const baseMax = clamp(num(insp.max, 6), 0, 99);
      const effMax = clamp(
        baseMax + getEffectValue(effectTotals, "inspMax"),
        0,
        99,
      );
      const v = clamp(num(insp.value, 6), 0, effMax);
      const next = clamp(v - 1, 0, effMax);
      await this.actor.update({
        "system.attributes.inspiration.max": baseMax,
        "system.attributes.inspiration.value": next,
      });
    });

    // Extra dice
    html.find("[data-action='extra-inc']").on("click", async (ev) => {
      ev.preventDefault();
      let cur = clamp(num(this.actor.getFlag(scope, "extraDice"), 2), 1, 20);
      cur = clamp(cur + 1, 1, 20);
      await this.actor.setFlag(scope, "extraDice", cur);
    });

    html.find("[data-action='extra-dec']").on("click", async (ev) => {
      ev.preventDefault();
      let cur = clamp(num(this.actor.getFlag(scope, "extraDice"), 2), 1, 20);
      cur = clamp(cur - 1, 1, 20);
      await this.actor.setFlag(scope, "extraDice", cur);
    });

    html.find("[data-action='extra-roll']").on("click", async (ev) => {
      ev.preventDefault();
      const cur = clamp(num(this.actor.getFlag(scope, "extraDice"), 2), 1, 20);
      const choice = await rollModeDialog("Доп. бросок");
      if (!choice) return;
      const pool = clamp(cur + globalMods.dice + num(choice.extraDice, 0), 1, 20);
      const effectTotals = collectEffectTotals(this.actor);
      const globalMods = getGlobalRollModifiers(effectTotals);
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

    // Create item
    html.find("[data-action='create-item']").on("click", async (ev) => {
      ev.preventDefault();
      await this.actor.createEmbeddedDocuments("Item", [
        {
          name: "Новый предмет",
          type: "item",
          system: {
            description: "",
            quantity: 1,
            actions: 1,
            type: "equipment",
            equipped: false,
            attackAttr: "combat",
            attackBonus: 0,
            armorBonus: 0,
            damage: 0,
            canBlock: false,
            effects: [],
          },
        },
      ]);
    });

    // Toggle equip
    html.find("[data-action='toggle-equip']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item) return;
      await item.update({ "system.equipped": !item.system?.equipped });
    });

    // Weapon attack
    html.find("[data-action='weapon-attack']").on("click", async (ev) => {
      ev.preventDefault();
      const weaponId = ev.currentTarget.dataset.itemId;
      const weapon = this.actor.items.get(weaponId);
      if (!weapon) return;
      if (game.vitruvium?.startWeaponAttackFlow) {
        await game.vitruvium.startWeaponAttackFlow(this.actor, weapon);
      }
    });

    // Item chat
    html.find("[data-action='item-chat']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item) return;

      const desc = String(item.system?.description ?? "");
      const descHtml = desc
        ? esc(desc).replace(/\n/g, "<br>")
        : `<span class="hint">Описание не задано.</span>`;

      const qty = Number(item.system?.quantity ?? 1);
      const img = item.img || "icons/svg/item-bag.svg";
      const typeLabel =
        item.type === "ability"
          ? "Способность"
          : item.type === "state"
            ? "Состояние"
            : "Предмет";

      const content = `
        <div class="vitruvium-chatcard v-itemcard">
          <div class="v-itemcard__top">
            <img class="v-itemcard__img" src="${esc(img)}" alt="${esc(item.name)}"/>
            <div class="v-itemcard__head">
              <div class="v-itemcard__title">@UUID[${item.uuid}]{${esc(item.name)}}${Number.isFinite(qty) ? ` ×${qty}` : ""}</div>
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

      if (game.vitruvium?.playAutomatedAnimation) {
        await playAutomatedAnimation({ actor: this.actor, item });
      }
    });

    // Create ability
    html.find("[data-action='create-ability']").on("click", async (ev) => {
      ev.preventDefault();
      await this.actor.createEmbeddedDocuments("Item", [
        {
          name: "Новая способность",
          type: "ability",
          system: {
            cost: 1,
            actions: 1,
            level: 1,
            type: "primary",
            active: false,
            attackRoll: false,
            attackAttr: "combat",
            rollDamageBase: 0,
            rollHealBase: 0,
            description: "",
            effects: [],
          },
        },
      ]);
    });

    // Use ability
    html.find("[data-action='use-ability']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const ability = this.actor.items.get(id);
      if (!ability) return;
      if (game.vitruvium?.startAbilityFlow) {
        await game.vitruvium.startAbilityFlow(this.actor, ability);
      }
    });

    // Toggle ability active
    html
      .find("[data-action='toggle-ability-active']")
      .on("click", async (ev) => {
        ev.preventDefault();
        const id = ev.currentTarget.dataset.itemId;
        const item = this.actor.items.get(id);
        if (!item) return;
        await item.update({ "system.active": !item.system?.active });
      });

    // Create state
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

    // Toggle state active
    html.find("[data-action='toggle-state-active']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item) return;
      const next = !item.system?.active;
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

    // Edit item
    html.find("[data-action='edit-item']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item) return;
      await item.sheet?.render(true);
    });

    // Delete item
    html.find("[data-action='delete-item']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      await this.actor.deleteEmbeddedDocuments("Item", [id]);
    });

    // Tab switching
    html.find(".v-tabs__toggle").on("change", (ev) => {
      this._activeTab = String(ev.currentTarget.value);
    });
  }
}
