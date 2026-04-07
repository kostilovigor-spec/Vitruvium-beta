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
      width: 720,
      minWidth: 600,
      height: 600,
      resizable: true,
      dragDrop: [{ dragSelector: ".v-list-item", dropSelector: null }],
    });
  }

  async getData(options) {
    const data = await super.getData(options);
    const sys = this.actor.system ?? {};
    const attrs = sys.attributes ?? {};
    const effectTotals = collectEffectTotals(this.actor);

    // Helpers
    const getAttr = (k) => getEffectiveAttribute(attrs, k, effectTotals);
    const toRnd = (v, d = 0) => Math.max(0, Math.round(toNumber(v, d)));

    // Use a fresh object to avoid potential collisions with existing data.vitruvium
    const vitruvium = {
      isEditing: this._isEditing || false
    };

    // 1. Header Data
    const hp = attrs.hp ?? { value: 5, max: 5 };
    const cond = getAttr("condition");
    const hpMax = cond * 8 + getEffectValue(effectTotals, "hpMax");
    const hpValue = clamp(hp.value, 0, hpMax);

    const insp = attrs.inspiration ?? { value: 0, max: 6 };
    const inspMax = clamp(toNumber(insp.max, 6) + getEffectValue(effectTotals, "inspMax"), 0, 99);
    const inspValue = clamp(insp.value, 0, inspMax);

    vitruvium.header = {
      hp: { value: hpValue, max: hpMax, pct: Math.min(100, (hpValue / hpMax) * 100) },
      inspiration: { value: inspValue, max: inspMax, pct: Math.min(100, (inspValue / inspMax) * 100) },
      level: attrs.level ?? 1,
      name: this.actor.name,
      img: this.actor.img,
      effects: this.actor.items.filter(i => i.type === "state" && i.system.active).map(e => ({
        id: e.id,
        img: e.img,
        name: e.name,
        description: e.system.description
      }))
    };

    // 2. Sidebar Data
    vitruvium.sidebar = {
      attributes: [
        { key: "condition", label: "CON", value: cond, icon: "fa-heart" },
        { key: "attention", label: "ATT", value: getAttr("attention"), icon: "fa-eye" },
        { key: "movement", label: "MOV", value: getAttr("movement"), icon: "fa-walking" },
        { key: "combat", label: "CMB", value: getAttr("combat"), icon: "fa-fist-raised" },
        { key: "thinking", label: "THK", value: getAttr("thinking"), icon: "fa-brain" },
        { key: "communication", label: "COM", value: getAttr("communication"), icon: "fa-comments" },
      ],
      derived: {
        armor: clamp(toNumber(sys.armor?.value ?? sys.armor, 0), 0, 99) +
          this.actor.items.reduce((acc, i) => acc + (i.type === "item" && i.system.equipped ? (i.system.armorBonus || 0) : 0), 0) +
          getEffectValue(effectTotals, "armorValue"),
        speed: 5 + getAttr("movement") + getEffectValue(effectTotals, "speed"),
        level: attrs.level ?? 1
      },
      coins: sys.coins ?? { bronze: 0, silver: 0, gold: 0 }
    };

    // 3. Central Zone (Tabs with Grouping)
    const items = this.actor.items;
    const groupBy = (arr, key) => arr.reduce((acc, obj) => {
      const v = foundry.utils.getProperty(obj, key) || "Other";
      if (!acc[v]) acc[v] = [];
      acc[v].push(obj);
      return acc;
    }, {});

    const weapons = items.filter(i => i.type === "item" && i.system.type === "weapon" && i.system.equipped);
    const activeAbilities = items.filter(i => i.type === "ability" && i.system.active);
    const collapsed = this.actor.getFlag("Vitruvium", "collapsedGroups") || [];

    vitruvium.tabs = {
      actions: {
        weapons: weapons.map(w => ({
          id: w.id,
          name: w.name,
          img: w.img,
          damage: w.system.attackBonus || 0
        })),
        abilities: activeAbilities.map(a => ({
          id: a.id,
          name: a.name,
          img: a.img,
          cost: a.system.cost
        })),
        luck: true,
        bonusDice: true
      },
      abilities: {
        groups: Object.entries(groupBy(items.filter(i => i.type === "ability"), "system.type")).map(([k, v]) => ({
          key: k,
          label: k,
          items: v,
          isCollapsed: collapsed.includes(`ability-${k}`)
        }))
      },
      inventory: {
        groups: Object.entries(groupBy(items.filter(i => i.type === "item"), "system.type")).map(([k, v]) => ({
          key: k,
          label: k,
          items: v,
          isCollapsed: collapsed.includes(`item-${k}`)
        }))
      },
      skills: {
        all: items.filter(i => i.type === "skill")
      },
      effects: {
        all: items.filter(i => i.type === "state").map(s => {
          const active = s.system.active !== false;
          const turnDur = toRnd(s.flags?.mySystem?.turnDuration, toRnd(s.system.durationRounds, 0));
          const rem = toRnd(s.flags?.mySystem?.remainingTurns, active ? turnDur : 0);
          return {
            id: s.id,
            name: s.name,
            img: s.img,
            active,
            duration: turnDur > 0 ? `${rem}/${turnDur}` : "∞"
          };
        })
      }
    };

    vitruvium.activeTab = this._activeTab || "actions";
    data.vitruvium = vitruvium;
    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.on("click", "[data-action]", (ev) => this._onAction(ev));
    html.find("input").on("change", (ev) => this._onInputChange(ev));
    html.find(".v-tab-link").on("click", (ev) => {
      this._activeTab = ev.currentTarget.dataset.tab;
      this.render();
    });
  }

  async _onAction(event) {
    event.preventDefault();
    const btn = event.currentTarget;
    const action = btn.dataset.action;
    const itemId = btn.dataset.itemId;
    const item = itemId ? this.actor.items.get(itemId) : null;

    switch (action) {
      case "toggle-edit":
        this._isEditing = !this._isEditing;
        this.render();
        break;
      case "use":
      case "attack":
        if (item?.type === "item") await game.vitruvium.startWeaponAttackFlow(this.actor, item);
        else if (item?.type === "ability") await game.vitruvium.startAbilityAttackFlow(this.actor, item);
        else if (item) this._postItemToChat(item);
        break;
      case "use-ability":
        if (item) await game.vitruvium.startAbilityAttackFlow(this.actor, item);
        break;
      case "roll-attr":
        await this._rollAttribute(btn.dataset.attr);
        break;
      case "toggle-equip":
        if (item) await item.update({ "system.equipped": !item.system.equipped });
        break;
      case "toggle-active":
        if (item) await item.update({ "system.active": !item.system.active });
        break;
      case "item-chat":
        if (item) this._postItemToChat(item);
        break;
      case "long-rest":
        await this._longRest();
        break;
      case "delete-item":
        if (item) await this._deleteItem(item);
        break;
      case "edit-item":
        if (item) item.sheet.render(true);
        break;
      case "create-item":
        await this.actor.createEmbeddedDocuments("Item", [{ name: `New ${btn.dataset.type}`, type: btn.dataset.type || "item" }]);
        break;
      case "roll-luck":
        await game.vitruvium.processor.process({ type: "luck", attacker: this.actor, options: {} });
        break;
      case "roll-bonus-dice":
        await game.vitruvium.processor.process({ type: "bonus_dice", attacker: this.actor, options: {} });
        break;
      case "toggle-group":
        await this._toggleGroup(btn.dataset.groupId);
        break;
    }
  }

  async _toggleGroup(groupId) {
    const collapsed = Array.from(this.actor.getFlag("Vitruvium", "collapsedGroups") || []);
    const idx = collapsed.indexOf(groupId);
    if (idx === -1) collapsed.push(groupId);
    else collapsed.splice(idx, 1);
    await this.actor.setFlag("Vitruvium", "collapsedGroups", collapsed);
  }

  async _onInputChange(ev) {
    const name = ev.currentTarget.name;
    let value = ev.currentTarget.value;
    if (ev.currentTarget.type === "number") value = Number(value);
    await this.actor.update({ [name]: value });
  }

  async _rollAttribute(key) {
    await game.vitruvium.processor.process({
      type: "attribute",
      attacker: this.actor,
      options: { attrKey: key }
    });
  }

  async _longRest() {
    const effectTotals = collectEffectTotals(this.actor);
    const cond = getEffectiveAttribute(this.actor.system.attributes, "condition", effectTotals);
    const hpMax = cond * 8 + getEffectValue(effectTotals, "hpMax");
    await this.actor.update({ "system.attributes.hp.value": hpMax, "system.attributes.inspiration.value": 6 });
  }

  async _deleteItem(item) {
    const ok = await Dialog.confirm({ title: `Delete ${item.name}?`, content: `Delete ${item.name}?` });
    if (ok) await item.delete();
  }

  _postItemToChat(item) {
    const content = `<div class="v-itemcard"><img src="${item.img}" width="32" height="32"/><b>${item.name}</b><p>${item.system.description || ""}</p></div>`;
    ChatMessage.create({ content });
  }
}
