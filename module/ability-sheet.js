import { EFFECT_TARGETS, normalizeEffects } from "./effects.js";

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
      Math.round(Number(sys.contestStateDurationRounds))
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
    const contestCasterAttr = finalKeys.includes(sys.contestCasterAttr)
      ? sys.contestCasterAttr
      : defaultAttr;
    const contestTargetAttr = finalKeys.includes(sys.contestTargetAttr)
      ? sys.contestTargetAttr
      : defaultAttr;
    const stateTemplates = await listSystemStateTemplates();
    const selectedStateUuid = String(sys.contestStateUuid ?? "");
    const hasSelectedState = stateTemplates.some(
      (state) => state.uuid === selectedStateUuid
    );
    data.vitruvium.attackAttrOptions = finalKeys.map((key) => ({
      key,
      label: attrLabels[key] ?? key,
    }));
    data.vitruvium.attackAttrDefault = defaultAttr;
    data.vitruvium.contestCasterAttr = contestCasterAttr;
    data.vitruvium.contestTargetAttr = contestTargetAttr;
    data.vitruvium.contestStateDurationRounds = sys.contestStateDurationRounds;
    data.vitruvium.stateTemplateOptions = stateTemplates;
    data.vitruvium.selectedStateUuid = hasSelectedState ? selectedStateUuid : "";
    data.vitruvium.hasStateTemplates = stateTemplates.length > 0;
    data.vitruvium.descriptionHTML = safe;
    data.vitruvium.effectTargets = EFFECT_TARGETS;
    data.vitruvium.effects = normalizeEffects(sys.effects, { keepZero: true });

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
              html.find("textarea[name='system.description']").val() ?? ""
            );
            await this.item.update({ img: path, "system.description": descVal });
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
    const $contestState = html.find("select[name='system.contestStateUuid']");
    const $contestStateDurationRounds = html.find(
      "input[name='system.contestStateDurationRounds']"
    );
    const $contestCasterAttr = html.find(
      "select[name='system.contestCasterAttr']"
    );
    const $contestTargetAttr = html.find(
      "select[name='system.contestTargetAttr']"
    );

    // Edit mode toggling.
    const form = html.closest("form");
    const view = html.find("[data-role='desc-view']");
    const edit = html.find("[data-role='desc-edit']");
    const btn = html.find("[data-action='toggle-desc']");

    const setMode = (isEdit) => {
      form.toggleClass("is-edit", isEdit);
      btn.toggleClass("is-active", isEdit);
      btn.attr("title", isEdit ? "Готово" : "Редактировать");
      if (isEdit) edit.trigger("focus");
    };

    if (this._editing === undefined) this._editing = false;
    setMode(this._editing);

    const currentDesc = () => String($desc.val() ?? this.item.system?.description ?? "");
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
        6
      );
      const newCost = clamp(
        num($cost.val(), num(this.item.system?.cost, 1)),
        0,
        6
      );
      const newActions = clamp(
        num($actions.val(), num(this.item.system?.actions, 1)),
        1,
        2
      );
      const newType = String($type.val() ?? this.item.system?.type ?? "primary");
      const newDesc = currentDesc();
      const newRollDamageBase = clamp(
        num($rollDamageBase.val(), num(this.item.system?.rollDamageBase, 0)),
        0,
        99
      );
      const newRollHealBase = clamp(
        num($rollHealBase.val(), num(this.item.system?.rollHealBase, 0)),
        0,
        99
      );
      const newAttackAttr = String(
        $attackAttr.val() ?? this.item.system?.attackAttr ?? "combat"
      );
      const hasStateOptions = $contestState.find("option[value!='']").length > 0;
      const selectedContestStateUuid = String($contestState.val() ?? "");
      const newContestStateUuid = hasStateOptions
        ? selectedContestStateUuid
        : String(this.item.system?.contestStateUuid ?? "");
      const newContestStateDurationRounds = Math.max(
        0,
        Math.round(
          num(
            $contestStateDurationRounds.val(),
            num(this.item.system?.contestStateDurationRounds, 1)
          )
        )
      );
      const newContestCasterAttr = String(
        $contestCasterAttr.val() ?? this.item.system?.contestCasterAttr ?? "combat"
      );
      const newContestTargetAttr = String(
        $contestTargetAttr.val() ?? this.item.system?.contestTargetAttr ?? "combat"
      );

      await this.item.update({
        name: newName,
        "system.level": newLevel,
        "system.cost": newCost,
        "system.actions": newActions,
        "system.type": newType,
        "system.rollDamageBase": newRollDamageBase,
        "system.rollHealBase": newRollHealBase,
        "system.attackAttr": newAttackAttr,
        "system.contestStateUuid": newContestStateUuid,
        "system.contestStateDurationRounds": newContestStateDurationRounds,
        "system.contestCasterAttr": newContestCasterAttr,
        "system.contestTargetAttr": newContestTargetAttr,
        "system.description": newDesc,
      });
    };

    // Toggle edit mode.
    btn.on("click", async (ev) => {
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
    $contestState.on("change", async (ev) => {
      await this.item.update({
        "system.contestStateUuid": String(ev.currentTarget.value ?? ""),
      });
    });
    $contestStateDurationRounds.on("change", async (ev) => {
      await this.item.update({
        "system.contestStateDurationRounds": Math.max(
          0,
          Math.round(num(ev.currentTarget.value, 1))
        ),
      });
    });
    $contestCasterAttr.on("change", async (ev) => {
      await this.item.update({
        "system.contestCasterAttr": String(ev.currentTarget.value ?? "combat"),
      });
    });
    $contestTargetAttr.on("change", async (ev) => {
      await this.item.update({
        "system.contestTargetAttr": String(ev.currentTarget.value ?? "combat"),
      });
    });

    // Save description draft on blur to avoid losing changes on rerender.
    $desc.on("blur", async () => {
      await saveDescriptionDraft();
    });

    // Effects table: row renderer.
    const renderEffectRow = (effect = {}) => {
      const key = EFFECT_TARGETS.find((t) => t.key === effect.key)?.key;
      const value = Number.isFinite(effect.value) ? effect.value : 0;
      const options = EFFECT_TARGETS.map((opt, idx) => {
        const selected = key ? opt.key === key : idx === 0 ? true : false;
        return `<option value="${opt.key}"${
          selected ? " selected" : ""
        }>${opt.label}</option>`;
      }).join("");

      return `
        <div class="v-effects__row">
          <select class="v-effects__key">${options}</select>
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
        if (!EFFECT_TARGETS.find((t) => t.key === key)) return;
        if (!Number.isFinite(value) || value === 0) return;
        next.push({ key, value });
      });
      await this.item.update({ "system.effects": next });
    };

    // Add effect row.
    html.on("click", "[data-action='add-effect']", (ev) => {
      ev.preventDefault();
      html.find(".v-effects__rows").append(renderEffectRow());
    });

    // Remove effect row.
    html.on("click", ".v-effects__remove", (ev) => {
      ev.preventDefault();
      $(ev.currentTarget).closest(".v-effects__row").remove();
      if (!html.find(".v-effects__row").length) {
        html.find(".v-effects__rows").append(renderEffectRow());
      }
      updateEffects();
    });

    // Persist effect edits.
    html.on("change", ".v-effects__key, .v-effects__val", () => {
      updateEffects();
    });
  }
}
