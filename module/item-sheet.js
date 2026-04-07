import {
  EFFECT_TARGETS,
  OVERTIME_EFFECT_TYPES,
  OVERTIME_TRIGGER_TIMINGS,
  normalizeEffects,
} from "./effects.js";

// Item sheet: inventory items and equipment.
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

  async getData() {
    const data = await super.getData();

    // Normalize system data and defaults.
    const sys = data.system ?? data.item?.system ?? this.item.system ?? {};
    if (!Number.isFinite(Number(sys.actions))) sys.actions = 1;
    if (typeof sys.canBlock !== "boolean") sys.canBlock = false;
    data.system = sys;

    // Description preview (HTML-safe).
    const desc = String(sys.description ?? "");

    const safe = foundry.utils.escapeHTML(desc).replace(/\n/g, "<br>");
    data.vitruvium = data.vitruvium || {};
    // Attack attribute options (based on parent actor).
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
    const overTimeKeys = new Set(OVERTIME_EFFECT_TYPES.map((t) => t.key));
    data.vitruvium.effectTargets = EFFECT_TARGETS;
    data.vitruvium.effects = normalizeEffects(sys.effects, {
      keepZero: true,
    }).map((eff) => ({
      ...eff,
      effectKey: overTimeKeys.has(String(eff.type ?? "").trim())
        ? String(eff.type ?? "").trim()
        : String(eff.key ?? ""),
      isOverTime: overTimeKeys.has(String(eff.type ?? "").trim()),
      triggerTiming: String(eff.triggerTiming ?? "end"),
    }));
    data.vitruvium.overTimeEffectTypes = OVERTIME_EFFECT_TYPES;
    data.vitruvium.overTimeTriggerTimings = OVERTIME_TRIGGER_TIMINGS;

    // Unique tab IDs per window instance to avoid conflicts when multiple sheets are open.
    const tabBase = `v-tabs-${this.appId}`;
    data.vitruvium.tabName = tabBase;
    data.vitruvium.tabIds = {
      desc: `${tabBase}-desc`,
      effects: `${tabBase}-effects`,
    };
    data.vitruvium.activeTab = this._itemTab ?? "desc";

    return data;
  }

  async close(options) {
    // Force submit when closing to ensure any pending changes (like description) are saved.
    await this._updateObject({}, this._getSubmitData());
    try {
      if (typeof this._saveDescOnClose === "function") {
        await this._saveDescOnClose();
      }
    } catch (e) {
      /* ignore */
    }
    return super.close(options);
  }

  async _updateObject(_event, formData) {
    // Remove tab selection from formData to keep it strictly local to this window
    for (const key of Object.keys(formData)) {
      if (key.startsWith("v-tabs-")) delete formData[key];
    }
    return this.item.update(formData);
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Local helpers.
    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };

    // Edit mode toggling.
    const form = html.closest("form");
    const view = html.find("[data-role='desc-view']");
    const edit = html.find("[data-role='desc-edit']");
    const btn = html.find("[data-action='toggle-desc']");
    const $desc = html.find("textarea[name='system.description']");

    const currentDesc = () =>
      String($desc.val() ?? this.item.system?.description ?? "");
    const saveDescriptionDraft = async () => {
      const newDesc = currentDesc();
      if (newDesc !== String(this.item.system?.description ?? "")) {
        await this.item.update({ "system.description": newDesc });
      }
    };
    this._saveDescOnClose = saveDescriptionDraft;

    html
      .find("img[data-edit='img']")
      .off("click.vitruvium-img")
      .on("click.vitruvium-img", (ev) => {
        ev.preventDefault();

        new FilePicker({
          type: "image",
          current: this.item.img,
          callback: async (path) => {
            const descVal = currentDesc();
            await this.item.update({
              img: path,
              "system.description": descVal,
            });
          },
        }).browse();
      });

    const setMode = (isEdit) => {
      form.toggleClass("is-edit", isEdit);
      btn.toggleClass("is-active", isEdit);
      btn.attr("title", isEdit ? "Готово" : "Редактировать");
      if (isEdit) edit.trigger("focus");
    };

    if (this._editing === undefined) this._editing = false;
    setMode(this._editing);

    // Toggle edit mode and persist description on exit.
    btn.on("click", async (ev) => {
      ev.preventDefault();

      this._editing = !this._editing;
      setMode(this._editing);

      if (!this._editing) {
        const text = String(edit.val() ?? "");
        await this.item.update({ "system.description": text });
        return;
      }
    });

    // Tab switching
    const tabBase = `v-tabs-${this.appId}`;
    if (this._itemTab === "effects") {
      const effectsRadio = html.find(`#${tabBase}-effects`);
      if (effectsRadio.length) effectsRadio.prop("checked", true);
    }
    html.find(".v-itemtabs__toggle").on("change", (ev) => {
      this._itemTab = ev.currentTarget.value === "effects" ? "effects" : "desc";
    });

    $desc.on("blur", async () => {
      await saveDescriptionDraft();
    });

    // Immediate save for item name on change.
    const $name = html.find("input[name='name']");
    $name.on("change", async () => {
      const v = String($name.val() ?? this.item.name);
      if (v && v !== this.item.name) await this.item.update({ name: v });
    });

    // Immediate save for price and quantity.
    html.find("input[name='system.price']").on("change", async (ev) => {
      const v = Math.max(0, num(ev.currentTarget.value, 0));
      await this.item.update({ "system.price": v });
    });
    html.find("input[name='system.quantity']").on("change", async (ev) => {
      const v = Math.max(1, Math.round(num(ev.currentTarget.value, 1)));
      await this.item.update({ "system.quantity": v });
    });

    // Immediate save for type and attackAttr selects.
    html.find("select[name='system.type']").on("change", async (ev) => {
      await this.item.update({ "system.type": String(ev.currentTarget.value) });
    });
    html.find("select[name='system.attackAttr']").on("change", async (ev) => {
      await this.item.update({
        "system.attackAttr": String(ev.currentTarget.value),
      });
    });

    // Immediate save for checkboxes.
    html.find("input[name='system.equipped']").on("change", async (ev) => {
      await this.item.update({ "system.equipped": ev.currentTarget.checked });
    });
    html.find("input[name='system.isShield']").on("change", async (ev) => {
      await this.item.update({ "system.isShield": ev.currentTarget.checked });
    });
    html.find("input[name='system.canBlock']").on("change", async (ev) => {
      await this.item.update({ "system.canBlock": ev.currentTarget.checked });
    });
    html.find("input[name='system.isHeavyArmor']").on("change", async (ev) => {
      await this.item.update({
        "system.isHeavyArmor": ev.currentTarget.checked,
      });
    });

    // Clamp item bonuses to 0..6 (only for item type)
    if (this.item.type === "item") {
      // Clamp bonuses and actions for item type.
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

    // Effects table: row renderer.
    const overTimeKeySet = new Set(OVERTIME_EFFECT_TYPES.map((t) => t.key));
    const overTimeTimingSet = new Set(
      OVERTIME_TRIGGER_TIMINGS.map((t) => t.key),
    );
    const syncOverTimeRow = ($row) => {
      const key = String($row.find(".v-effects__key").val() ?? "");
      const isTimed = overTimeKeySet.has(key);
      const $timing = $row.find(".v-effects__timing");
      const $value = $row.find(".v-effects__val");
      $timing.toggle(isTimed);
      if (isTimed) {
        const cur = num($value.val(), 0);
        $value.val(Math.max(0, Math.round(Math.abs(cur))));
      }
    };
    const renderEffectRow = (effect = {}) => {
      const typeKey = String(effect.type ?? "").trim();
      const isOverTime = overTimeKeySet.has(typeKey);
      const key = isOverTime
        ? typeKey
        : EFFECT_TARGETS.find((t) => t.key === effect.key)?.key ??
        EFFECT_TARGETS[0]?.key;
      const rawValue = Number.isFinite(effect.value) ? Number(effect.value) : 0;
      const value = isOverTime
        ? Math.max(0, Math.round(Math.abs(rawValue)))
        : rawValue;
      const triggerTiming = overTimeTimingSet.has(
        String(effect.triggerTiming ?? "").trim(),
      )
        ? String(effect.triggerTiming).trim()
        : "end";

      // Группируем эффекты по категориям
      const groupedOptions = {};
      for (const opt of EFFECT_TARGETS) {
        const group = opt.group || "other";
        if (!groupedOptions[group]) {
          groupedOptions[group] = [];
        }
        groupedOptions[group].push(opt);
      }

      // Создаем опции с группировкой
      let options = "";
      for (const [groupName, groupItems] of Object.entries(groupedOptions)) {
        if (groupItems.length > 0) {
          options += `<optgroup label="${groupName}">`;
          for (const opt of groupItems) {
            const selected = key
              ? opt.key === key
              : opt === groupItems[0]
                ? true
                : false;
            options += `<option value="${opt.key}"${selected ? " selected" : ""}>${opt.label}</option>`;
          }
          options += `</optgroup>`;
        }
      }
      for (const opt of OVERTIME_EFFECT_TYPES) {
        const selected = opt.key === key ? " selected" : "";
        options += `<option value="${opt.key}"${selected}>${opt.label}</option>`;
      }
      const timingOptions = OVERTIME_TRIGGER_TIMINGS.map((opt) => {
        const selected = opt.key === triggerTiming ? " selected" : "";
        return `<option value="${opt.key}"${selected}>${opt.label}</option>`;
      }).join("");

      return `
        <div class="v-effects__row">
          <select class="v-effects__key">${options}</select>
          <select class="v-effects__timing" ${isOverTime ? "" : "style='display:none;'"
        }>${timingOptions}</select>
          <input type="number" class="v-effects__val" value="${value}" step="1" />
          <button type="button" class="v-mini v-effects__remove" title="Удалить">x</button>
        </div>
      `;
    };

    // Effects table: persist changes.
    const updateEffects = async () => {
      const next = [];
      html.find(".v-effects__row").each((_, row) => {
        const $row = $(row);
        const key = String($row.find(".v-effects__key").val() ?? "");
        const value = num($row.find(".v-effects__val").val(), 0);
        if (overTimeKeySet.has(key)) {
          const triggerRaw = String(
            $row.find(".v-effects__timing").val() ?? "end",
          ).trim();
          const triggerTiming = overTimeTimingSet.has(triggerRaw)
            ? triggerRaw
            : "end";
          const timedValue = Math.max(0, Math.round(Math.abs(value)));
          if (!Number.isFinite(timedValue) || timedValue <= 0) return;
          next.push({ type: key, triggerTiming, value: timedValue });
          return;
        }
        if (!EFFECT_TARGETS.find((t) => t.key === key)) return;
        if (!Number.isFinite(value) || value === 0) return;
        next.push({ key, value });
      });
      await this.item.update({ "system.effects": next });
    };

    const existingEffects = normalizeEffects(this.item.system?.effects, {
      keepZero: true,
    });
    html
      .find(".v-effects__rows")
      .html(
        existingEffects.length
          ? existingEffects.map((eff) => renderEffectRow(eff)).join("")
          : renderEffectRow(),
      );

    // Add effect row.
    html.on("click", "[data-action='add-effect']", (ev) => {
      ev.preventDefault();
      const $rows = html.find(".v-effects__rows");
      $rows.append(renderEffectRow());
      syncOverTimeRow($rows.find(".v-effects__row").last());
    });

    // Remove effect row.
    html.on("click", ".v-effects__remove", (ev) => {
      ev.preventDefault();
      $(ev.currentTarget).closest(".v-effects__row").remove();
      if (!html.find(".v-effects__row").length) {
        const $rows = html.find(".v-effects__rows");
        $rows.append(renderEffectRow());
        syncOverTimeRow($rows.find(".v-effects__row").last());
      }
      updateEffects();
    });

    html.on("change", ".v-effects__key, .v-effects__val, .v-effects__timing", (ev) => {
      if ($(ev.currentTarget).hasClass("v-effects__key")) {
        syncOverTimeRow($(ev.currentTarget).closest(".v-effects__row"));
      }
      if ($(ev.currentTarget).hasClass("v-effects__val")) {
        const $row = $(ev.currentTarget).closest(".v-effects__row");
        const key = String($row.find(".v-effects__key").val() ?? "");
        if (overTimeKeySet.has(key)) {
          const cur = num($(ev.currentTarget).val(), 0);
          $(ev.currentTarget).val(Math.max(0, Math.round(Math.abs(cur))));
        }
      }
      updateEffects();
    });
    html.find(".v-effects__row").each((_, row) => {
      syncOverTimeRow($(row));
    });
  }
}

