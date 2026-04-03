import {
  EFFECT_TARGETS,
  OVERTIME_EFFECT_TYPES,
  OVERTIME_TRIGGER_TIMINGS,
  normalizeEffects,
} from "./effects.js";

import { listSystemStateTemplates } from "./state-library.js";

// Ability sheet: editing, effects, and attack attributes.
export class VitruviumAbilitySheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "ability"],
      template: "systems/Vitruvium/templates/item/ability-sheet.hbs",
      width: 860,
      height: 520,
      resizable: true,

      // Save on explicit "Done" toggle to avoid noisy auto-submit.
      submitOnChange: false,
      submitOnClose: false,
    });
  }

  async getData() {
    const data = await super.getData();

    // Normalize system data and defaults.
    const sys = data.system ?? data.item?.system ?? this.item.system ?? {};
    if (!Number.isFinite(Number(sys.rollDamageBase))) sys.rollDamageBase = 0;
    if (!Number.isFinite(Number(sys.rollHealBase))) sys.rollHealBase = 0;
    if (!Number.isFinite(Number(sys.contestStateDurationRounds))) {
      sys.contestStateDurationRounds = 1;
    }
    sys.contestStateDurationRounds = Math.max(
      0,
      Math.round(Number(sys.contestStateDurationRounds)),
    );
    if (!Number.isFinite(Number(sys.actions))) sys.actions = 1;
    if (typeof sys.attackRoll !== "boolean") sys.attackRoll = false;
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
    const stateTemplates = await listSystemStateTemplates();
    // Normalize contestStates array - support both old and new format
    let contestStates = Array.isArray(sys.contestStates)
      ? sys.contestStates
      : [];
    // Migrate from old single-state format if contestStates is empty
    if (contestStates.length === 0 && sys.contestStateUuid) {
      contestStates = [
        {
          uuid: sys.contestStateUuid || "",
          durationRounds: Number(sys.contestStateDurationRounds) || 1,
          applyMode: [
            "self",
            "targetNoCheck",
            "targetContest",
            "CRIT_ATTACK",
          ].includes(
            sys.contestApplyMode,
          )
            ? sys.contestApplyMode
            : "targetContest",
          casterAttr: String(sys.contestCasterAttr ?? defaultAttr),
          targetAttr: String(sys.contestTargetAttr ?? defaultAttr),
        },
      ];
    }
    // Ensure at least one empty state entry
    if (contestStates.length === 0) {
      contestStates = [
        {
          uuid: "",
          durationRounds: 1,
          applyMode: "targetContest",
          casterAttr: defaultAttr,
          targetAttr: defaultAttr,
        },
      ];
    }
    // Normalize each state entry
    contestStates = contestStates.map((s) => ({
      uuid: String(s.uuid ?? ""),
      durationRounds: Math.max(0, Math.round(Number(s.durationRounds ?? 1))),
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
      casterAttr: String(s.casterAttr ?? defaultAttr),
      targetAttr: String(s.targetAttr ?? defaultAttr),
    }));
    data.vitruvium.attackAttrOptions = finalKeys.map((key) => ({
      key,
      label: attrLabels[key] ?? key,
    }));
    data.vitruvium.attackAttrDefault = defaultAttr;
    data.vitruvium.contestStates = contestStates;
    data.vitruvium.stateTemplateOptions = stateTemplates;
    data.vitruvium.hasStateTemplates = stateTemplates.length > 0;
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
    data.vitruvium.activeTab = this._abilityTab ?? "desc";

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

  activateListeners(html) {
    super.activateListeners(html);

    // Restore active tab (Описание / Эффекты) after re-render.
    const tabBase = `v-tabs-${this.appId}`;
    if (this._abilityTab === "effects") {
      const effectsRadio = html.find(`#${tabBase}-effects`);
      if (effectsRadio.length) effectsRadio.prop("checked", true);
    }
    html.find(".v-itemtabs__toggle").on("change", (ev) => {
      this._abilityTab = ev.currentTarget.value === "effects" ? "effects" : "desc";
    });

    // Icon editing should always be available.
    html
      .find("img[data-edit='img']")
      .off("click.vitruvium-img")
      .on("click.vitruvium-img", (ev) => {
        ev.preventDefault();

        new FilePicker({
          type: "image",
          current: this.item.img,
          callback: async (path) => {
            const descVal = String(
              html.find("textarea[name='system.description']").val() ?? "",
            );
            await this.item.update({
              img: path,
              "system.description": descVal,
            });
          },
        }).browse();
      });

    // Local helpers.
    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };

    const $name = html.find("input[name='name']");
    const $level = html.find("input[name='system.level']");
    const $cost = html.find("input[name='system.cost']");
    const $actions = html.find("input[name='system.actions']");
    const $type = html.find("select[name='system.type']");
    const $desc = html.find("textarea[name='system.description']");
    const $rollDamageBase = html.find("input[name='system.rollDamageBase']");
    const $rollHealBase = html.find("input[name='system.rollHealBase']");
    const $active = html.find("input[name='system.active']");
    const $attackRoll = html.find("input[name='system.attackRoll']");
    const $attackAttr = html.find("select[name='system.attackAttr']");

    // Edit mode toggling.
    const form = html.closest("form");
    const view = html.find("[data-role='desc-view']");
    const edit = html.find("[data-role='desc-edit']");

    const setMode = (isEdit) => {
      form.toggleClass("is-edit", isEdit);
      const $btn = html.find("[data-action='toggle-desc']");
      $btn.toggleClass("is-active", isEdit);
      $btn.attr("title", isEdit ? "Готово" : "Редактировать");
      if (isEdit) edit.trigger("focus");
    };

    if (this._editing === undefined) this._editing = false;
    setMode(this._editing);

    const currentDesc = () =>
      String($desc.val() ?? this.item.system?.description ?? "");
    const saveDescriptionDraft = async () => {
      const newDesc = currentDesc();
      if (newDesc !== String(this.item.system?.description ?? "")) {
        await this.item.update({ "system.description": newDesc });
      }
    };
    this._saveDescOnClose = saveDescriptionDraft;

    // Persist values when leaving edit mode.
    const exitEditAndSave = async () => {
      const newName = String($name.val() ?? this.item.name);
      const newLevel = clamp(
        num($level.val(), num(this.item.system?.level, 1)),
        1,
        6,
      );
      const newCost = clamp(
        num($cost.val(), num(this.item.system?.cost, 1)),
        0,
        6,
      );
      const newActions = clamp(
        num($actions.val(), num(this.item.system?.actions, 1)),
        1,
        2,
      );
      const newType = String(
        $type.val() ?? this.item.system?.type ?? "primary",
      );
      const newDesc = currentDesc();
      const newRollDamageBase = clamp(
        num($rollDamageBase.val(), num(this.item.system?.rollDamageBase, 0)),
        0,
        99,
      );
      const newRollHealBase = clamp(
        num($rollHealBase.val(), num(this.item.system?.rollHealBase, 0)),
        0,
        99,
      );
      const newAttackAttr = String(
        $attackAttr.val() ?? this.item.system?.attackAttr ?? "combat",
      );
      // Collect contestStates from form - include all rows, even without uuid
      const contestStates = [];
      html.find(".v-contest-states__row").each((_, row) => {
        const $row = $(row);
        const uuid = String(
          $row
            .find("select[name^='system.contestStates'][name$='.uuid']")
            .val() ?? "",
        );
        const durationRounds = Math.max(
          0,
          Math.round(num($row.find("input[name$='.durationRounds']").val(), 1)),
        );
        const applyMode = String(
          $row.find("select[name$='.applyMode']").val() ?? "targetContest",
        );
        const casterAttr = String(
          $row.find("select[name$='.casterAttr']").val() ?? "combat",
        );
        const targetAttr = String(
          $row.find("select[name$='.targetAttr']").val() ?? "combat",
        );
        contestStates.push({
          uuid,
          durationRounds,
          applyMode,
          casterAttr,
          targetAttr,
        });
      });
      // Ensure at least one entry for migration compatibility
      if (contestStates.length === 0) {
        contestStates.push({
          uuid: "",
          durationRounds: 1,
          applyMode: "targetContest",
          casterAttr: "combat",
          targetAttr: "combat",
        });
      }

      await this.item.update({
        name: newName,
        "system.level": newLevel,
        "system.cost": newCost,
        "system.actions": newActions,
        "system.type": newType,
        "system.rollDamageBase": newRollDamageBase,
        "system.rollHealBase": newRollHealBase,
        "system.attackAttr": newAttackAttr,
        "system.contestStates": contestStates,
        "system.description": newDesc,
      });
    };

    // Toggle edit mode - use event delegation to avoid issues with re-render.
    html.on("click", "[data-action='toggle-desc']", async (ev) => {
      ev.preventDefault();

      this._editing = !this._editing;
      setMode(this._editing);
      if (!this._editing) {
        await exitEditAndSave();
      }
    });

    // Active toggle.
    $active.on("change", async (ev) => {
      await this.item.update({ "system.active": ev.currentTarget.checked });
    });
    // Attack roll toggle.
    $attackRoll.on("change", async (ev) => {
      await this.item.update({ "system.attackRoll": ev.currentTarget.checked });
    });
    // Ability type selector.
    $type.on("change", async (ev) => {
      await this.item.update({
        "system.type": String(ev.currentTarget.value ?? "primary"),
      });
    });
    // Attack attribute selector.
    $attackAttr.on("change", async (ev) => {
      await this.item.update({
        "system.attackAttr": String(ev.currentTarget.value ?? "combat"),
      });
    });

    // Contest states: Add row button.
    // Use event delegation on the form element for dynamic content
    const $form = html.closest("form");
    $form.on("click", "[data-action='add-contest-state']", async (ev) => {
      ev.preventDefault();
      const $container = html.find(".v-contest-states__rows");
      const idx = $container.find(".v-contest-states__row").length;
      const sheetData = await this.getData();
      const stateTemplates = sheetData.vitruvium?.stateTemplateOptions ?? [];
      const attrOptions = sheetData.vitruvium?.attackAttrOptions ?? [];
      const defaultAttr = sheetData.vitruvium?.attackAttrDefault ?? "combat";
      const stateOptions = stateTemplates
        .map((st) => `<option value="${st.uuid}">${st.name}</option>`)
        .join("");
      const attrOptionsHtml = attrOptions
        .map(
          (opt) =>
            `<option value="${opt.key}"${
              opt.key === defaultAttr ? " selected" : ""
            }>${opt.label}</option>`,
        )
        .join("");
      const rowHtml = `
        <div class="v-contest-states__row" data-idx="${idx}">
          <div class="v-contest-states__row-header">
            <span>Состояние #${idx + 1}</span>
            <button type="button" class="v-mini v-contest-states__remove" title="Удалить">?</button>
          </div>
          <div class="v-contest-states__fields">
            <label>
              <span>Состояние</span>
              <select name="system.contestStates.${idx}.uuid" class="v-item__select">
                <option value="">Не накладывать</option>
                ${stateOptions}
              </select>
            </label>
            <label class="v-contest-states__duration">
              <span>Длит. (ходы)</span>
              <input
                type="number"
                name="system.contestStates.${idx}.durationRounds"
                value="1"
                data-dtype="Number"
                min="0"
                step="1"
              />
            </label>
            <label>
              <span>Способ наложения</span>
              <select name="system.contestStates.${idx}.applyMode" class="v-item__select">
                <option value="self">На себя</option>
                <option value="targetNoCheck">Цель: без проверки</option>
                <option value="targetContest" selected>Цель: соревнование</option>
                <option value="CRIT_ATTACK">Цель: при крите атаки</option>
              </select>
            </label>
            <label>
              <span>Атрибут кастера</span>
              <select name="system.contestStates.${idx}.casterAttr" class="v-item__select">
                ${attrOptionsHtml}
              </select>
            </label>
            <label>
              <span>Атрибут цели</span>
              <select name="system.contestStates.${idx}.targetAttr" class="v-item__select">
                ${attrOptionsHtml}
              </select>
            </label>
          </div>
        </div>
      `;
      $container.append(rowHtml);
      // Save after adding - use saveContestStates helper
      saveContestStates();
    });

    // Contest states: Remove row button.
    // Use event delegation on the form element for dynamic content
    $form.on("click", ".v-contest-states__remove", (ev) => {
      ev.preventDefault();
      const $btn = $(ev.currentTarget);
      const $row = $btn.closest(".v-contest-states__row");
      $row.remove();
      // Re-index rows
      const $container = html.find(".v-contest-states__rows");
      $container.find(".v-contest-states__row").each((idx, row) => {
        const $r = $(row);
        $r.attr("data-idx", idx);
        $r.find("span")
          .first()
          .text(`Состояние #${idx + 1}`);
        $r.find("select[name$='.uuid']").attr(
          "name",
          `system.contestStates.${idx}.uuid`,
        );
        $r.find("input[name$='.durationRounds']").attr(
          "name",
          `system.contestStates.${idx}.durationRounds`,
        );
        $r.find("select[name$='.applyMode']").attr(
          "name",
          `system.contestStates.${idx}.applyMode`,
        );
        $r.find("select[name$='.casterAttr']").attr(
          "name",
          `system.contestStates.${idx}.casterAttr`,
        );
        $r.find("select[name$='.targetAttr']").attr(
          "name",
          `system.contestStates.${idx}.targetAttr`,
        );
      });
      // Save after removing - use saveContestStates helper
      saveContestStates();
    });

    // Contest states: Save on change for all fields.
    // Use debounce to avoid multiple rapid saves
    let contestStatesSaveTimeout = null;
    const saveContestStates = () => {
      if (contestStatesSaveTimeout) clearTimeout(contestStatesSaveTimeout);
      contestStatesSaveTimeout = setTimeout(async () => {
        const $rows = html.find(".v-contest-states__row");
        const contestStates = [];
        $rows.each((_, row) => {
          const $r = $(row);
          const uuid = String($r.find("select[name$='.uuid']").val() ?? "");
          const durationRounds = Math.max(
            0,
            Math.round(num($r.find("input[name$='.durationRounds']").val(), 1)),
          );
          const applyMode = String(
            $r.find("select[name$='.applyMode']").val() ?? "targetContest",
          );
          const casterAttr = String(
            $r.find("select[name$='.casterAttr']").val() ?? "combat",
          );
          const targetAttr = String(
            $r.find("select[name$='.targetAttr']").val() ?? "combat",
          );
          // Include states even without uuid to preserve attr selections
          contestStates.push({
            uuid,
            durationRounds,
            applyMode,
            casterAttr,
            targetAttr,
          });
        });
        if (contestStates.length === 0) {
          contestStates.push({
            uuid: "",
            durationRounds: 1,
            applyMode: "targetContest",
            casterAttr: "combat",
            targetAttr: "combat",
          });
        }
        await this.item.update({ "system.contestStates": contestStates });
      }, 250);
    };

    // Use event delegation on the form element for dynamic content
    $form.on(
      "change",
      ".v-contest-states__row select, .v-contest-states__row input",
      saveContestStates,
    );

    // Immediate save on change for all editable fields.
    $name.on("change", async () => {
      const v = String($name.val() ?? this.item.name);
      if (v && v !== this.item.name) await this.item.update({ name: v });
    });
    $level.on("change", async () => {
      const v = clamp(num($level.val(), num(this.item.system?.level, 1)), 1, 6);
      await this.item.update({ "system.level": v });
    });
    $cost.on("change", async () => {
      const v = clamp(num($cost.val(), num(this.item.system?.cost, 1)), 0, 6);
      await this.item.update({ "system.cost": v });
    });
    $actions.on("change", async () => {
      const v = clamp(
        num($actions.val(), num(this.item.system?.actions, 1)),
        1,
        2,
      );
      await this.item.update({ "system.actions": v });
    });
    $rollDamageBase.on("change", async () => {
      const v = clamp(num($rollDamageBase.val(), 0), 0, 99);
      await this.item.update({ "system.rollDamageBase": v });
    });
    $rollHealBase.on("change", async () => {
      const v = clamp(num($rollHealBase.val(), 0), 0, 99);
      await this.item.update({ "system.rollHealBase": v });
    });

    // Save description draft on blur to avoid losing changes on rerender.
    $desc.on("blur", async () => {
      await saveDescriptionDraft();
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
        const cur = num($value.val(), 0);
        $value.val(Math.max(0, Math.round(Math.abs(cur))));
      }
    };

    // Effects table: row renderer.
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

    // Persist effect edits.
    html.on("change", ".v-effects__key, .v-effects__val, .v-effects__timing", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
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
