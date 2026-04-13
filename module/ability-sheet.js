import { openModifierEditor, presentModifiers } from "./core/modifier-system.js";
import { ConditionResolver } from "./core/condition-resolver.js";
import { listSystemStateTemplates } from "./state-library.js";

// Ability sheet: editing, modifiers, and attack attributes.
export class VitruviumAbilitySheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "ability"],
      template: "systems/Vitruvium/templates/item/ability-sheet.hbs",
      width: 860,
      height: 520,
      resizable: true,
      submitOnChange: false,
      submitOnClose: false,
    });
  }

  async getData() {
    const data = await super.getData();

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
    if (typeof sys.canBlock !== "boolean") sys.canBlock = false;
    data.system = sys;

    const desc = String(sys.description ?? "");
    const safe = foundry.utils.escapeHTML(desc).replace(/\n/g, "<br>");
    data.vitruvium = data.vitruvium || {};

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

    let contestStates = Array.isArray(sys.contestStates)
      ? sys.contestStates
      : [];
    if (contestStates.length === 0 && sys.contestStateUuid) {
      const oldMode = sys.contestApplyMode ?? "targetContest";
      const normalized = ConditionResolver.normalizeApplyMode(oldMode);
      contestStates = [
        {
          uuid: sys.contestStateUuid || "",
          durationRounds: Number(sys.contestStateDurationRounds) || 1,
          applyMode: normalized.mode,
          condition: normalized.condition,
          casterAttr: String(sys.contestCasterAttr ?? defaultAttr),
          targetAttr: String(sys.contestTargetAttr ?? defaultAttr),
        },
      ];
    }
    if (contestStates.length === 0) {
      contestStates = [
        {
          uuid: "",
          durationRounds: 1,
          applyMode: "targetContest",
          condition: null,
          casterAttr: defaultAttr,
          targetAttr: defaultAttr,
        },
      ];
    }
    contestStates = contestStates.map((s) => {
      const normalized = ConditionResolver.normalizeApplyMode(s.applyMode);
      const cond = normalized.condition;
      return {
        uuid: String(s.uuid ?? ""),
        durationRounds: Math.max(0, Math.round(Number(s.durationRounds ?? 1))),
        applyMode: normalized.mode,
        conditionType: String(s.conditionType ?? "").trim() || (cond?.type ?? ""),
        conditionValue: s.conditionValue !== undefined && s.conditionValue !== "" && s.conditionValue !== null
          ? Number(s.conditionValue)
          : (cond?.value ?? ""),
        casterAttr: String(s.casterAttr ?? defaultAttr),
        targetAttr: String(s.targetAttr ?? defaultAttr),
      };
    });

    data.vitruvium.attackAttrOptions = finalKeys.map((key) => ({
      key,
      label: attrLabels[key] ?? key,
    }));
    data.vitruvium.attackAttrDefault = defaultAttr;
    data.vitruvium.contestStates = contestStates;
    data.vitruvium.stateTemplateOptions = stateTemplates;
    data.vitruvium.hasStateTemplates = stateTemplates.length > 0;
    data.vitruvium.descriptionHTML = safe;
    data.vitruvium.modifierRows = presentModifiers(sys.modifiers);
    data.vitruvium.modifierCount = Array.isArray(sys.modifiers)
      ? sys.modifiers.length
      : 0;

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
    } catch (_e) {
      // ignore
    }
    return super.close(options);
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".v-tab-link").on("click", (ev) => {
      ev.preventDefault();
      this._abilityTab = ev.currentTarget.dataset.tab;
      this.render();
    });

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

    const form = html.closest("form");
    const edit = html.find("[data-role='desc-edit']");

    const setMode = (isEdit) => {
      form.toggleClass("is-edit", isEdit);
      const $btn = html.find("[data-action='toggle-desc']");
      $btn.toggleClass("is-active", isEdit);
      $btn.attr("title", isEdit ? "Завершить редактирование" : "Редактировать");
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
      const newType = String($type.val() ?? this.item.system?.type ?? "primary");
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

    html.on("click", "[data-action='toggle-desc']", async (ev) => {
      ev.preventDefault();

      this._editing = !this._editing;
      setMode(this._editing);
      if (!this._editing) {
        await exitEditAndSave();
      }
    });

    $active.on("change", async (ev) => {
      await this.item.update({ "system.active": ev.currentTarget.checked });
    });
    $attackRoll.on("change", async (ev) => {
      await this.item.update({ "system.attackRoll": ev.currentTarget.checked });
    });
    $type.on("change", async (ev) => {
      await this.item.update({
        "system.type": String(ev.currentTarget.value ?? "primary"),
      });
    });
    $attackAttr.on("change", async (ev) => {
      await this.item.update({
        "system.attackAttr": String(ev.currentTarget.value ?? "combat"),
      });
    });

    html.find("input[name='system.canBlock']").on("change", async (ev) => {
      await this.item.update({ "system.canBlock": ev.currentTarget.checked });
    });

    const $form = html.closest("form");

    // --- Contest states (debounce 250ms как в оригинале) ---

    let contestStatesSaveTimeout = null;
    const saveContestStates = () => {
      if (contestStatesSaveTimeout) clearTimeout(contestStatesSaveTimeout);
      contestStatesSaveTimeout = setTimeout(async () => {
        const contestStates = [];
        html.find(".v-contest-states__row").each((_, row) => {
          const $r = $(row);
          const uuid = String($r.find("[data-field='uuid']").val() ?? "");
          const durationRounds = Math.max(
            0,
            Math.round(num($r.find("[data-field='durationRounds']").val(), 1)),
          );
          const applyMode = String(
            $r.find("[data-field='applyMode']").val() ?? "targetContest",
          );
          const conditionValueRaw = $r.find("[data-field='conditionValue']").val();
          const conditionValue = conditionValueRaw !== undefined && conditionValueRaw !== "" && conditionValueRaw !== null
            ? Math.max(0, Math.round(num(conditionValueRaw, 0)))
            : "";
          const casterAttr = String(
            $r.find("[data-field='casterAttr']").val() ?? "combat",
          );
          const targetAttr = String(
            $r.find("[data-field='targetAttr']").val() ?? "combat",
          );
          contestStates.push({
            uuid,
            durationRounds,
            applyMode,
            conditionType: applyMode === "margin" ? "margin" : "",
            conditionValue,
            casterAttr,
            targetAttr,
          });
        });
        if (contestStates.length === 0) {
          contestStates.push({
            uuid: "",
            durationRounds: 1,
            applyMode: "targetContest",
            condition: null,
            casterAttr: "combat",
            targetAttr: "combat",
          });
        }
        await this.item.update({ "system.contestStates": contestStates });
      }, 250);
    };

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
            <button type="button" class="v-mini v-contest-states__remove" title="Удалить">×</button>
          </div>
          <div class="v-contest-states__fields">
            <label>
              <span>Состояние</span>
              <select data-field="uuid" class="v-item__select">
                <option value="">Не накладывать</option>
                ${stateOptions}
              </select>
            </label>
            <label class="v-contest-states__duration">
              <span>Длит. (ходы)</span>
              <input type="number" data-field="durationRounds" value="1" data-dtype="Number" min="0" step="1" />
            </label>
            <label>
              <span>Способ наложения</span>
              <select data-field="applyMode" class="v-item__select v-apply-mode-select">
                <option value="self">На себя</option>
                <option value="targetNoCheck">Цель: без проверки</option>
                <option value="targetContest" selected>Цель: соревнование</option>
                <option value="margin">При разнице успехов ≥</option>
              </select>
            </label>
            <label class="v-field--margin" style="display:none">
              <span>Порог разницы успехов</span>
              <input type="number" data-field="conditionValue" class="v-item__input" value="" placeholder="—" data-dtype="Number" min="0" step="1" />
            </label>
            <span class="v-field--contest-attrs">
            <label>
              <span>Атрибут кастера</span>
              <select data-field="casterAttr" class="v-item__select">
                ${attrOptionsHtml}
              </select>
            </label>
            <label>
              <span>Атрибут цели</span>
              <select data-field="targetAttr" class="v-item__select">
                ${attrOptionsHtml}
              </select>
            </label>
            </span>
          </div>
        </div>
      `;
      $container.append(rowHtml);
      saveContestStates();
    });

    $form.on("click", ".v-contest-states__remove", (ev) => {
      ev.preventDefault();
      const $btn = $(ev.currentTarget);
      const $row = $btn.closest(".v-contest-states__row");
      $row.remove();
      const $container = html.find(".v-contest-states__rows");
      $container.find(".v-contest-states__row").each((idx, row) => {
        const $r = $(row);
        $r.attr("data-idx", idx);
        $r.find("span").first().text(`Состояние #${idx + 1}`);
      });
      saveContestStates();
    });

    $form.on(
      "change",
      ".v-contest-states__row select, .v-contest-states__row input",
      function (ev) {
        const $target = $(ev.currentTarget);
        const $row = $target.closest(".v-contest-states__row");
        if ($target.is("[data-field='applyMode']")) {
          const mode = String($target.val() ?? "targetContest");
          $row.find(".v-field--contest-attrs").toggle(mode === "targetContest");
          $row.find(".v-field--margin").toggle(mode === "margin");
        }
        saveContestStates();
      },
    );

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
      const v = clamp(num($actions.val(), num(this.item.system?.actions, 1)), 1, 2);
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

    $desc.on("blur", async () => {
      await saveDescriptionDraft();
    });

    html.on("click", "[data-action='edit-modifiers']", async (ev) => {
      ev.preventDefault();
      await openModifierEditor(this.item);
      this.render();
    });
  }
}
