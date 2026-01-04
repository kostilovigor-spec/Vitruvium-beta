import { rollSuccessDice } from "./rolls.js";
import { startWeaponAttackFlow } from "./combat.js";

// import { startAttackFlow } from "./combat.js";

/**
 * Vitruvium Character Sheet
 * - Attributes (1..6) with +/- and roll buttons
 * - Inspiration (value/max) with +/-
 * - HP max = 5 * condition (auto), HP value manual input (saved on blur/change/Enter)
 * - Extra dice quick roll (stored in Actor flags, stable)
 * - Abilities (Items: ability): create/open/delete/use (spend inspiration + chat card)
 */
export class VitruviumCharacterSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "actor"],
      template: "systems/vitruvium/templates/actor/character-sheet.hbs",
      width: 640,
      height: 720,
      // We keep global auto-submit OFF (it caused annoying resets),
      // and instead manually persist specific fields (HP) below.
      submitOnChange: true,
      submitOnClose: true,
    });
  }

  getData() {
    const data = super.getData();

    const sys = data.system ?? this.actor.system ?? {};
    const attrs = sys.attributes ?? {};

    const abilities = (this.actor.items ?? []).filter(
      (i) => i.type === "ability"
    );
    data.vitruvium = data.vitruvium ?? {};
    data.vitruvium.abilities = abilities;

    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };

    const getAttr = (k) => clamp(num(attrs[k], 1), 1, 6);

    // Inspiration
    const insp = attrs.inspiration ?? { value: 6, max: 6 };
    const inspValue = clamp(num(insp.value, 6), 0, 99);
    const inspMax = clamp(num(insp.max, 6), 0, 99);

    // HP (max always derived)
    const condition = getAttr("condition");
    const hpMax = condition * 5;
    const hp = attrs.hp ?? { value: hpMax, max: hpMax };
    const hpValue = clamp(num(hp.value, hpMax), 0, hpMax);

    // Extra dice stored in flags (scope must match system id)
    const scope = game.system.id;
    const savedExtra = this.actor.getFlag(scope, "extraDice");
    let extraDice = clamp(num(savedExtra, 2), 1, 20);

    data.vitruvium = data.vitruvium || {};
    const icons = {
      condition: "♥",
      attention: "◉",
      movement: "➜",
      combat: "⚔",
      thinking: "✦",
      communication: "☉",
    };

    data.vitruvium.attributes = [
      {
        key: "condition",
        label: "Самочувствие",
        value: attrs.condition,
        icon: icons.condition,
      },
      {
        key: "attention",
        label: "Внимание",
        value: attrs.attention,
        icon: icons.attention,
      },
      {
        key: "movement",
        label: "Движение",
        value: attrs.movement,
        icon: icons.movement,
      },
      {
        key: "combat",
        label: "Сражение",
        value: attrs.combat,
        icon: icons.combat,
      },
      {
        key: "thinking",
        label: "Мышление",
        value: attrs.thinking,
        icon: icons.thinking,
      },
      {
        key: "communication",
        label: "Общение",
        value: attrs.communication,
        icon: icons.communication,
      },
    ];

    const savedMode = this.actor.getFlag(scope, "rollMode");
    data.vitruvium.rollMode = savedMode ?? "normal";

    data.vitruvium = data.vitruvium || {};
    data.vitruvium.items = this.actor.items.filter((i) => i.type === "item");
    data.vitruvium.inspiration = { value: inspValue, max: inspMax };
    data.vitruvium.hp = { value: hpValue, max: hpMax };
    data.vitruvium.extraDice = extraDice;
    // Keep data.system.attributes.hp in sync for templates/tokens that read it
    data.system = data.system || {};
    data.system.attributes = data.system.attributes || {};
    data.system.attributes.hp = data.system.attributes.hp || {};
    data.system.attributes.hp.value = hpValue;
    data.system.attributes.hp.max = hpMax;

    data.vitruvium.level = Number(attrs.level ?? 1);

    const baseAttack = Number(attrs.attack ?? 0);
    const baseArmor = Number(attrs.armor ?? 0);

    let bonusAttack = 0;
    let bonusArmor = 0;

    const clamp6 = (n) => Math.min(Math.max(Number(n ?? 0), 0), 6);

    for (const it of this.actor.items) {
      if (it.type !== "item") continue;
      const sys = it.system ?? {};
      if (!sys.equipped) continue;

      bonusAttack += clamp6(sys.attackBonus);
      bonusArmor += clamp6(sys.armorBonus);
    }

    data.vitruvium.attack = baseAttack; // база (редактируемая)
    data.vitruvium.armor = baseArmor; // база (редактируемая)
    data.vitruvium.attackBonus = bonusAttack; // бонус (отображаем)
    data.vitruvium.armorBonus = bonusArmor; // бонус (отображаем)
    data.vitruvium.attackTotal = baseAttack + bonusAttack;
    data.vitruvium.armorTotal = baseArmor + bonusArmor;

    // speed = movement * 2
    const mv = Number(attrs.movement ?? 1);
    data.vitruvium.speed = Math.max(mv * 2, 5);

    return data;
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
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const scope = game.system.id;

    // ===== Roll mode (normal / adv / dis) saved in flags =====
    html.find("[data-action='set-rollmode']").on("click", async (ev) => {
      ev.preventDefault();
      const mode = ev.currentTarget.dataset.mode;
      const scope = game.system.id;
      await this.actor.setFlag(scope, "rollMode", mode);
    });

    // ===== Attributes +/- (1..6) =====
    html.find("[data-action='attr-inc']").on("click", async (ev) => {
      ev.preventDefault();
      const key = ev.currentTarget.dataset.attr;

      const attrs = this.actor.system.attributes ?? {};
      const current = clamp(num(attrs[key], 1), 1, 6);
      const next = clamp(current + 1, 1, 6);

      const patch = { [`system.attributes.${key}`]: next };

      // Auto HP max = 5 * condition (and clamp hp.value)
      if (key === "condition") {
        const newMaxHp = next * 5;
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

    html.find("[data-action='attr-dec']").on("click", async (ev) => {
      ev.preventDefault();
      const key = ev.currentTarget.dataset.attr;

      const attrs = this.actor.system.attributes ?? {};
      const current = clamp(num(attrs[key], 1), 1, 6);
      const next = clamp(current - 1, 1, 6);

      const patch = { [`system.attributes.${key}`]: next };

      if (key === "condition") {
        const newMaxHp = next * 5;
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

    // ===== Roll attribute check =====
    html.find("[data-action='roll-attribute']").on("click", async (ev) => {
      ev.preventDefault();
      const btn = ev.currentTarget;

      const key = btn.dataset.attr;
      const label = btn.dataset.label ?? key;
      const scope = game.system.id;
      const rollMode = this.actor.getFlag(scope, "rollMode") ?? "normal";

      const attrs = this.actor.system.attributes ?? {};
      let pool = clamp(num(attrs[key], 1), 1, 6);

      // Call rolls.js in a backward/forward compatible way
      await rollSuccessDice({
        pool,
        actorName: this.actor.name,
        checkName: label,
        mode: rollMode,
        label: `Проверка: ${label}`, // harmless if rolls.js ignores it
      });
    });

    // ===== Inspiration +/- (0..max) =====
    html.find("[data-action='insp-inc']").on("click", async (ev) => {
      ev.preventDefault();

      const insp = this.actor.system.attributes?.inspiration ?? {
        value: 6,
        max: 6,
      };
      const m = clamp(num(insp.max, 6), 0, 99);
      const v = clamp(num(insp.value, 6) + 1, 0, m);

      await this.actor.update({
        "system.attributes.inspiration.max": m,
        "system.attributes.inspiration.value": v,
      });
    });

    html.find("[data-action='insp-dec']").on("click", async (ev) => {
      ev.preventDefault();

      const insp = this.actor.system.attributes?.inspiration ?? {
        value: 6,
        max: 6,
      };
      const m = clamp(num(insp.max, 6), 0, 99);
      const v = clamp(num(insp.value, 6) - 1, 0, m);

      await this.actor.update({
        "system.attributes.inspiration.max": m,
        "system.attributes.inspiration.value": v,
      });
    });

    // ===== Extra dice (flags) =====
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

      const scope = game.system.id;
      const rollMode = this.actor.getFlag(scope, "rollMode") ?? "normal";
      const cur = clamp(num(this.actor.getFlag(scope, "extraDice"), 2), 1, 20);

      await rollSuccessDice({
        pool: cur,
        actorName: this.actor.name,
        checkName: "Дополнительные кубы",
        mode: rollMode,
      });
    });

    // ===== Luck roll (always 1 die) =====
    html.find("[data-action='luck-roll']").on("click", async (ev) => {
      ev.preventDefault();

      const scope = game.system.id;
      const rollMode = this.actor.getFlag(scope, "rollMode") ?? "normal";

      await rollSuccessDice({
        pool: 1,
        actorName: this.actor.name,
        checkName: "Бросок удачи",
        mode: rollMode,
      });
    });

    // ===== Attack button =====
    html.find("[data-action='attack']").on("click", async (ev) => {
      ev.preventDefault();

      console.log("Vitruvium | Attack button clicked");

      // Нужно: контролить свой токен
      const myToken = canvas.tokens.controlled?.[0];
      if (!myToken) {
        ui.notifications?.warn(
          "Выбери свой токен на сцене (controlled), затем выбери цель (target)."
        );
        return;
      }

      // Нужно: выбрать цель (target)
      const target = [...game.user.targets]?.[0];
      if (!target) {
        ui.notifications?.warn(
          "Выбери цель (target) перед атакой (клавиша T)."
        );
        return;
      }

      await startAttackFlow(this.actor);
    });

    // ===== Items (type: item) =====
    html.find("[data-action='create-item']").on("click", async (ev) => {
      ev.preventDefault();
      await this.actor.createEmbeddedDocuments("Item", [
        {
          name: "Новый предмет",
          type: "item",
          system: { description: "", quantity: 1 },
        },
      ]);
    });

    // ===== Toggle item equipped state =====
    html.find("[data-action='toggle-equip']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item) return;

      const sys = item.system ?? {};
      const next = !sys.equipped;

      await item.update({ "system.equipped": next });
    });

    // ===== Weapon attack button =====
    html.find("[data-action='weapon-attack']").on("click", async (ev) => {
      ev.preventDefault();
      const weaponId = ev.currentTarget.dataset.itemId;
      const weapon = this.actor.items.get(weaponId);
      if (!weapon) return;

      await game.vitruvium.startWeaponAttackFlow(this.actor, weapon);
    });

    // ===== Post inventory item to chat =====
    // ===== Item -> Chat (with image + description) =====
    html.find("[data-action='item-chat']").on("click", async (ev) => {
      ev.preventDefault();

      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item) return;

      const esc = (s) =>
        String(s ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");

      const desc = String(item.system?.description ?? "");
      const descHtml = desc
        ? esc(desc).replace(/\n/g, "<br>")
        : `<span class="hint">Описание не задано.</span>`;

      const qty = Number(item.system?.quantity ?? 1);
      const qtyText = Number.isFinite(qty) ? ` ×${qty}` : "";

      const img = item.img || "icons/svg/item-bag.svg";

      const content = `
    <div class="vitruvium-chatcard v-itemcard">
      <div class="v-itemcard__top">
        <img class="v-itemcard__img" src="${esc(img)}" alt="${esc(item.name)}"/>
        <div class="v-itemcard__head">
          <div class="v-itemcard__title">${esc(item.name)}${qtyText}</div>
          <div class="v-itemcard__sub">${esc(this.actor.name)} · предмет</div>
        </div>
      </div>
      <div class="v-itemcard__desc">${descHtml}</div>
    </div>
  `;

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content,
      });
    });

    // ===== Abilities (Items: ability) =====
    html.find("[data-action='create-ability']").on("click", async (ev) => {
      ev.preventDefault();
      await this.actor.createEmbeddedDocuments("Item", [
        {
          name: "Новая способность",
          type: "ability",
          system: { cost: 1, description: "" },
        },
      ]);
    });

    // ===== Ability level (inline edit) =====
    html.find("[data-action='set-ability-level']").on("change", async (ev) => {
      ev.preventDefault();

      const input = ev.currentTarget;
      const id = input.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item) return;

      let level = Number(input.value);
      if (Number.isNaN(level)) level = 0;
      level = Math.min(Math.max(level, 0), 20);

      await item.update({ "system.level": level });
    });

    html.find("[data-action='edit-item']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (item) item.sheet.render(true);
    });

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

    html.find("[data-action='use-ability']").on("click", async (ev) => {
      ev.preventDefault();
      const id = ev.currentTarget.dataset.itemId;
      const item = this.actor.items.get(id);
      if (!item) return;

      const sys = item.system ?? {};
      const cost = Math.max(0, num(sys.cost, 0));
      const desc = String(sys.description ?? "");

      // Current inspiration
      const insp = this.actor.system.attributes?.inspiration ?? {
        value: 0,
        max: 6,
      };
      const inspValue = num(insp.value, 0);

      if (inspValue < cost) {
        ui.notifications?.warn(
          `Недостаточно вдохновения: нужно ${cost}, есть ${inspValue}`
        );
        return;
      }

      await this.actor.update({
        "system.attributes.inspiration.value": inspValue - cost,
      });
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
              ? `<p>${esc(desc).replace(/\\n/g, "<br>")}</p>`
              : `<p class="hint">Описание не задано.</p>`
          }
        </div>
      `;

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content,
      });
    });

    // ===== HP manual input: persist on INPUT (debounced) + blur/Enter =====
    // Fixes: field clearing on rerender when clicking buttons (create/use ability etc.)
    const hpInput = html.find("input[name='system.attributes.hp.value']");
    if (hpInput.length) {
      const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
      const num = (v, d) => {
        const x = Number(v);
        return Number.isNaN(x) ? d : x;
      };

      let hpTimer = null;

      const computeMaxHp = () => {
        const attrs = this.actor.system.attributes ?? {};
        const condition = clamp(num(attrs.condition, 1), 1, 6);
        return condition * 5;
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
        // update only if changed (reduces rerenders)
        const current = num(this.actor.system.attributes?.hp?.value, 0);
        if (v === current) return;
        await this.actor.update({ "system.attributes.hp.value": v });
      };

      const scheduleSave = () => {
        if (hpTimer) clearTimeout(hpTimer);
        hpTimer = setTimeout(() => {
          hpTimer = null;
          // fire and forget, but keep errors visible
          saveHpNow().catch(console.error);
        }, 150);
      };

      // Save while typing (prevents losing value on rerender)
      hpInput.on("input", scheduleSave);

      // Also save on blur/change (extra safety)
      hpInput.on("change", scheduleSave);
      hpInput.on("blur", scheduleSave);

      // Enter: save immediately
      hpInput.on("keydown", async (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        ev.stopPropagation();
        if (hpTimer) clearTimeout(hpTimer);
        hpTimer = null;
        await saveHpNow();
        hpInput.blur();
      });

      // Before clicking any button on the sheet, flush pending HP to avoid rerender wipe
      html.find("button").on("mousedown", async () => {
        if (!hpTimer) return;
        clearTimeout(hpTimer);
        hpTimer = null;
        await saveHpNow();
      });
    }
  }
}
