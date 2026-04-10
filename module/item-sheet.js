import { openModifierEditor, presentModifiers } from "./core/modifier-system.js";
import { listSystemStateTemplates } from "./state-library.js";

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

    const sys = data.system ?? data.item?.system ?? this.item.system ?? {};
    if (!Number.isFinite(Number(sys.actions))) sys.actions = 1;
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
      contestStates = [
        {
          uuid: sys.contestStateUuid || "",
          durationRounds: Number(sys.contestStateDurationRounds) || 1,
          applyMode: [
            "self",
            "targetNoCheck",
            "targetContest",
            "CRIT_ATTACK",
          ].includes(sys.contestApplyMode)
            ? sys.contestApplyMode
            : "targetContest",
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
          casterAttr: defaultAttr,
          targetAttr: defaultAttr,
        },
      ];
    }
    contestStates = contestStates.map((s) => ({
      uuid: String(s.uuid ?? ""),
      durationRounds: Math.max(0, Math.round(Number(s.durationRounds ?? 1))),
      applyMode: [
        "self",
        "targetNoCheck",
        "targetContest",
        "CRIT_ATTACK",
      ].includes(s.applyMode)
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
    data.vitruvium.activeTab = this._itemTab ?? "desc";

    return data;
  }

  async close(options) {
    await this._updateObject({}, this._getSubmitData());
    try {
      if (typeof this._saveDescOnClose === "function") {
        await this._saveDescOnClose();
      }
    } catch (_e) {
      // ignore
    }
    return super.close(options);
  }

  async _updateObject(_event, formData) {
    for (const key of Object.keys(formData)) {
      if (key.startsWith("v-tabs-")) delete formData[key];
    }
    return this.item.update(formData);
  }

  activateListeners(html) {
    super.activateListeners(html);

    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };

    const form = html.closest("form");
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

    btn.on("click", async (ev) => {
      ev.preventDefault();
      this._editing = !this._editing;
      setMode(this._editing);

      if (!this._editing) {
        const text = String(edit.val() ?? "");
        await this.item.update({ "system.description": text });
      }
    });

    html.find(".v-tab-link").on("click", (ev) => {
      ev.preventDefault();
      this._itemTab = ev.currentTarget.dataset.tab;
      this.render();
    });

    let contestStatesSaveTimeout = null;
    const saveContestStates = () => {
      if (contestStatesSaveTimeout) clearTimeout(contestStatesSaveTimeout);
      contestStatesSaveTimeout = setTimeout(async () => {
        const contestStates = [];
        html.find(".v-contest-states__row").each((_, row) => {
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

    html.on("click", "[data-action='add-contest-state']", async (ev) => {
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
      saveContestStates();
    });

    html.on("click", ".v-contest-states__remove", (ev) => {
      ev.preventDefault();
      $(ev.currentTarget).closest(".v-contest-states__row").remove();
      const $container = html.find(".v-contest-states__rows");
      $container.find(".v-contest-states__row").each((idx, row) => {
        const $r = $(row);
        $r.attr("data-idx", idx);
        $r.find("span")
          .first()
          .text(`Состояние #${idx + 1}`);
        $r.find("select[name$='.uuid']").attr("name", `system.contestStates.${idx}.uuid`);
        $r.find("input[name$='.durationRounds']").attr(
          "name",
          `system.contestStates.${idx}.durationRounds`,
        );
        $r.find("select[name$='.applyMode']").attr("name", `system.contestStates.${idx}.applyMode`);
        $r.find("select[name$='.casterAttr']").attr("name", `system.contestStates.${idx}.casterAttr`);
        $r.find("select[name$='.targetAttr']").attr("name", `system.contestStates.${idx}.targetAttr`);
      });
      saveContestStates();
    });

    html.on(
      "change",
      ".v-contest-states__row select, .v-contest-states__row input",
      saveContestStates,
    );

    $desc.on("blur", async () => {
      await saveDescriptionDraft();
    });

    const $name = html.find("input[name='name']");
    $name.on("change", async () => {
      const v = String($name.val() ?? this.item.name);
      if (v && v !== this.item.name) await this.item.update({ name: v });
    });

    html.find("input[name='system.price']").on("change", async (ev) => {
      const v = Math.max(0, num(ev.currentTarget.value, 0));
      await this.item.update({ "system.price": v });
    });
    html.find("input[name='system.quantity']").on("change", async (ev) => {
      const v = Math.max(1, Math.round(num(ev.currentTarget.value, 1)));
      await this.item.update({ "system.quantity": v });
    });

    html.find("select[name='system.type']").on("change", async (ev) => {
      await this.item.update({ "system.type": String(ev.currentTarget.value) });
    });
    html.find("select[name='system.attackAttr']").on("change", async (ev) => {
      await this.item.update({
        "system.attackAttr": String(ev.currentTarget.value),
      });
    });

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

    if (this.item.type === "item") {
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

    html.on("click", "[data-action='edit-modifiers']", async (ev) => {
      ev.preventDefault();
      await openModifierEditor(this.item);
      this.render();
    });
  }
}
