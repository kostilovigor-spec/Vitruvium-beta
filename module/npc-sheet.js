import { clamp, toNumber } from "./utils/number.js";
import { escapeHtml } from "./utils/string.js";
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
      width: 600,
      height: 520,
      resizable: true,
      submitOnChange: true,
      submitOnClose: true,
      dragDrop: [{ dragSelector: ".v-list-item", dropSelector: null }],
    });
  }

  /** Fixed order for inventory categories */
  #inventoryOrder = ["weapon", "equipment", "consumables", "tools", "trinkets", "loot"];

  /** Map of English group keys to Russian labels */
  #groupLabels = {
    "weapon": "Оружие",
    "equipment": "Снаряжение",
    "consumables": "Расходники",
    "trinkets": "Безделушки",
    "tools": "Инструменты",
    "loot": "Добыча",
    "Other": "Прочее",
  };

  async getData(options) {
    const data = await super.getData(options);
    const sys = this.actor.system ?? {};
    const attrs = sys.attributes ?? {};
    const effectTotals = collectEffectTotals(this.actor);

    // Helpers
    const getAttr = (k) => getEffectiveAttribute(attrs, k, effectTotals);
    const toRnd = (v, d = 0) => Math.max(0, Math.round(toNumber(v, d)));

    const vitruvium = {
      isEditing: this._isEditing || false
    };

    // 1. Header Data
    const hp = attrs.hp ?? { value: 5, max: 5 };
    const cond = getAttr("condition");
    const hpMax = clamp(toNumber(hp.max, 5), 0, 999);
    const hpValue = clamp(hp.value, 0, hpMax);

    vitruvium.header = {
      hp: { value: hpValue, max: hpMax, pct: Math.min(100, (hpValue / hpMax) * 100) },
      name: this.actor.name,
      img: this.actor.img,
      level: attrs.level ?? 1,
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
        speed: clamp(toNumber(sys.speed?.value ?? sys.speed, 5), 0, 99)
      }
    };

    // 3. Central Zone (Tabs with Grouping)
    const items = this.actor.items;
    const groupBy = (arr, key) => arr.reduce((acc, obj) => {
      const v = foundry.utils.getProperty(obj, key) || "Other";
      if (!acc[v]) acc[v] = [];
      acc[v].push(obj);
      return acc;
    }, {});

    vitruvium.tabs = {
      actions: {
        weapons: items.filter(i => i.type === "item" && i.system.type === "weapon").map(w => ({
          id: w.id,
          name: w.name,
          img: w.img,
          damage: w.system.attackBonus || 0,
          equipped: w.system.equipped !== false
        })),
        abilities: items.filter(i => i.type === "ability").map(a => ({
          id: a.id,
          name: a.name,
          img: a.img,
          cost: a.system.cost,
          active: a.system.active !== false
        })),
        quickRolls: vitruvium.sidebar.attributes
      },
      inventory: {
        groups: (() => {
          const inventoryItems = items.filter(i => i.type === "item");
          const grouped = {};
          for (const type of this.#inventoryOrder) {
            grouped[type] = [];
          }
          for (const item of inventoryItems) {
            const category = item.system?.type || "Other";
            if (grouped[category] !== undefined) {
              grouped[category].push(item);
            } else {
              if (!grouped["Other"]) grouped["Other"] = [];
              grouped["Other"].push(item);
            }
          }
          return this.#inventoryOrder.map(type => ({
            key: type,
            label: this.#groupLabels[type] || type,
            items: grouped[type] || []
          }));
        })()
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
        if (item?.type === "item") {
          if (this._itemHasDamage(item)) await game.vitruvium.startWeaponAttackFlow(this.actor, item);
          else this._postItemToChat(item);
        } else if (item?.type === "ability") {
          if (this._itemHasDamage(item)) await game.vitruvium.startAbilityAttackFlow(this.actor, item);
          else if (await this._consumeAbilityCost(item)) this._postItemToChat(item);
        }
        else if (item) this._postItemToChat(item);
        break;
      case "use-ability":
        if (item) {
          if (this._itemHasDamage(item)) await game.vitruvium.startAbilityAttackFlow(this.actor, item);
          else if (await this._consumeAbilityCost(item)) this._postItemToChat(item);
        }
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
      case "delete-item":
        if (item) await this._deleteItem(item);
        break;
      case "edit-item":
        if (item) item.sheet.render(true);
        break;
      case "create-item":
        await this.actor.createEmbeddedDocuments("Item", [{ name: `New ${btn.dataset.type}`, type: btn.dataset.type || "item" }]);
        break;
      case "add-inventory-item":
        await this._createItemFromCategory(btn.dataset.type);
        break;
    }
  }

  async _onInputChange(ev) {
    const name = ev.currentTarget.name;
    let value = ev.currentTarget.value;
    if (ev.currentTarget.type === "number") value = Number(value);
    await this.actor.update({ [name]: value });
  }

  async _rollAttribute(key) {
    const attrs = this.actor.system.attributes ?? {};
    const effectTotals = collectEffectTotals(this.actor);
    const pool = Math.max(1, getEffectiveAttribute(attrs, key, effectTotals));
    await rollSuccessDice({ pool, actorName: this.actor.name, checkName: key.toUpperCase() });
  }

  async _deleteItem(item) {
    const ok = await Dialog.confirm({ title: `Delete ${item.name}?`, content: `<p>Delete <b>${item.name}</b>?</p>` });
    if (ok) await item.delete();
  }

  async _createItemFromCategory(type) {
    const itemData = {
      name: "Новый предмет",
      type: "item",
      system: {
        type: type,
        quantity: 1,
        price: 0,
        equipped: false,
        description: ""
      }
    };
    return this.actor.createEmbeddedDocuments("Item", [itemData]);
  }

  _itemHasDamage(item) {
    if (!item) return false;
    if (item.type === "item") return Math.max(0, toNumber(item.system?.attackBonus, 0)) > 0;
    if (item.type === "ability") return Math.max(0, toNumber(item.system?.rollDamageBase, 0)) > 0;
    return false;
  }

  async _consumeAbilityCost(item) {
    if (!item || item.type !== "ability") return true;
    const cost = clamp(toNumber(item.system?.cost, 0), 0, 6);
    if (cost <= 0) return true;

    const currentInsp = toNumber(this.actor.system?.attributes?.inspiration?.value, 0);
    if (currentInsp < cost) {
      ui.notifications?.warn(
        `Недостаточно вдохновения для использования способности. Требуется: ${cost}, доступно: ${currentInsp}`,
      );
      return false;
    }

    await this.actor.update({
      "system.attributes.inspiration.value": currentInsp - cost,
    });
    return true;
  }

  _postItemToChat(item) {
    const name = escapeHtml(item.name ?? "Предмет");
    const img = escapeHtml(item.img ?? "icons/svg/item-bag.svg");
    const desc = String(item.system?.description ?? "");
    const descHtml = desc ? escapeHtml(desc).replace(/\n/g, "<br>") : "";
    const content = `
      <div class="v-itemcard">
        <div class="v-itemcard__top">
          <img class="v-itemcard__img" src="${img}" alt="${name}"/>
          <div class="v-itemcard__head">
            <div class="v-itemcard__title">@UUID[${item.uuid}]{${name}}</div>
          </div>
        </div>
        ${descHtml ? `<div class="v-itemcard__desc">${descHtml}</div>` : ""}
      </div>
    `;
    ChatMessage.create({ content });
  }
}
