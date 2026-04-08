import {
  EFFECT_TARGETS,
  OVERTIME_EFFECT_TYPES,
  OVERTIME_TRIGGER_TIMINGS,
  normalizeEffects,
} from "./effects.js";

export class VitruviumSkillSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "skill"],
      template: "systems/Vitruvium/templates/item/skill-sheet.hbs",
      width: 720,
      height: 520,
      submitOnChange: true,
      submitOnClose: true,
      resizable: true,
    });
  }

  getData() {
    const data = super.getData();
    const sys = data.system ?? data.item?.system ?? this.item.system ?? {};
    const isState = this.item.type === "state";
    const toRounds = (v, d = 0) => {
      const n = Number(v);
      const safe = Number.isFinite(n) ? n : d;
      return Math.max(0, Math.round(safe));
    };
    const stateActive = isState ? sys.active !== false : false;
    const turnDuration = isState
      ? toRounds(
          this.item?.flags?.mySystem?.turnDuration,
          toRounds(sys.durationRounds, 0),
        )
      : 0;
    const remainingTurns = isState
      ? toRounds(
          this.item?.flags?.mySystem?.remainingTurns,
          toRounds(sys.durationRemaining, stateActive ? turnDuration : 0),
        )
      : 0;
    data.system = sys;
    if (typeof sys.canBlock !== "boolean") sys.canBlock = false;
    if (isState) {
      data.system.active = stateActive;
      data.system.durationRounds = turnDuration;
      data.system.durationRemaining = remainingTurns;
    }
    const desc = String(sys.description ?? "");
    const safe = foundry.utils.escapeHTML(desc).replace(/\n/g, "<br>");
    data.vitruvium = data.vitruvium || {};
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
    data.vitruvium.isState = isState;
    data.vitruvium.expireOnTurnStart =
      this.item?.flags?.mySystem?.expireOnTurnStart === true;

    // Unique tab IDs per window instance to avoid conflicts when multiple sheets are open.
    const tabBase = `v-tabs-${this.appId}`;
    data.vitruvium.tabName = tabBase;
    data.vitruvium.tabIds = {
      desc: `${tabBase}-desc`,
      effects: `${tabBase}-effects`,
    };
    data.vitruvium.activeTab = this._activeTab ?? "desc";

    return data;
  }

  async close(options) {
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

    // Tab switching
    html.find(".v-tab-link").on("click", (ev) => {
      ev.preventDefault();
      this._activeTab = ev.currentTarget.dataset.tab;
      this.render();
    });

    const form = html.closest("form");
    const view = html.find("[data-role='desc-view']");
    const edit = html.find("[data-role='desc-edit']");
    const btn = html.find("[data-action='toggle-desc']");
    const $name = html.find("input[name='name']");
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
            await this.item.update({ img: path, "system.description": descVal });
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

    const exitEditAndSave = async () => {
      const newName = String($name.val() ?? this.item.name);
      const newDesc = String($desc.val() ?? "");
      await this.item.update({
        name: newName,
        "system.description": newDesc,
      });
    };

    btn.on("click", async (ev) => {
      ev.preventDefault();
      this._editing = !this._editing;
      setMode(this._editing);
      if (!this._editing) {
        await exitEditAndSave();
      }
    });

    $desc.on("blur", async () => {
      await saveDescriptionDraft();
    });

    // Immediate save for name on change.
    $name.on("change", async () => {
      const v = String($name.val() ?? this.item.name);
      if (v && v !== this.item.name) await this.item.update({ name: v });
    });

    // Immediate save for state-specific fields.
    html.find("input[name='system.active']").on("change", async (ev) => {
      const next = ev.currentTarget.checked;
      const turnDuration = Math.max(
        0,
        Math.round(
          Number(this.item.flags?.mySystem?.turnDuration ?? this.item.system?.durationRounds) || 0,
        ),
      );
      await this.item.update({
        "system.active": next,
        "system.durationRounds": turnDuration,
        "system.durationRemaining": next ? turnDuration : 0,
        "flags.mySystem.turnDuration": turnDuration,
        "flags.mySystem.remainingTurns": next ? turnDuration : 0,
        "flags.mySystem.ownerActorId": this.item.actor?.id ?? "",
      });
    });
    html.find("input[name='system.durationRounds']").on("change", async (ev) => {
      const v = Math.max(0, Math.round(Number(ev.currentTarget.value) || 0));
      const isActive = this.item.system?.active !== false;
      await this.item.update({
        "system.durationRounds": v,
        "system.durationRemaining": isActive ? v : 0,
        "flags.mySystem.turnDuration": v,
        "flags.mySystem.remainingTurns": isActive ? v : 0,
        "flags.mySystem.ownerActorId": this.item.actor?.id ?? "",
      });
    });
    html
      .find("input[name='flags.mySystem.expireOnTurnStart']")
      .on("change", async (ev) => {
        await this.item.update({
          "flags.mySystem.expireOnTurnStart": ev.currentTarget.checked,
        });
      });

    // CanBlock toggle.
    html.find("input[name='system.canBlock']").on("change", async (ev) => {
      await this.item.update({ "system.canBlock": ev.currentTarget.checked });
    });

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
        const cur = Number($value.val()) || 0;
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
      let options = EFFECT_TARGETS.map((opt, idx) => {
        const selected = key ? opt.key === key : idx === 0 ? true : false;
        return `<option value="${opt.key}"${
          selected ? " selected" : ""
        }>${opt.label}</option>`;
      }).join("");
      options += OVERTIME_EFFECT_TYPES.map((opt) => {
        const selected = opt.key === key ? " selected" : "";
        return `<option value="${opt.key}"${selected}>${opt.label}</option>`;
      }).join("");
      const timingOptions = OVERTIME_TRIGGER_TIMINGS.map((opt) => {
        const selected = opt.key === triggerTiming ? " selected" : "";
        return `<option value="${opt.key}"${selected}>${opt.label}</option>`;
      }).join("");

      return `
        <div class="v-effects__row">
          <select class="v-effects__key">${options}</select>
          <select class="v-effects__timing" ${
            isOverTime ? "" : "style='display:none;'"
          }>${timingOptions}</select>
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
        const value = Number($row.find(".v-effects__val").val());
        if (overTimeKeySet.has(key)) {
          const triggerRaw = String(
            $row.find(".v-effects__timing").val() ?? "end",
          ).trim();
          const triggerTiming = overTimeTimingSet.has(triggerRaw)
            ? triggerRaw
            : "end";
          const timedValue = Math.max(0, Math.round(Math.abs(value || 0)));
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

    html.on("click", "[data-action='add-effect']", (ev) => {
      ev.preventDefault();
      const $rows = html.find(".v-effects__rows");
      $rows.append(renderEffectRow());
      syncOverTimeRow($rows.find(".v-effects__row").last());
    });

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
          const cur = Number($(ev.currentTarget).val()) || 0;
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

