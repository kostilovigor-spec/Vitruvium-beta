import { openEffectsDialog } from "./effects.js";

export class VitruviumAbilitySheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "ability"],
      template: "systems/Vitruvium/templates/item/ability-sheet.hbs",
      width: 860,
      height: 520,
      resizable: true,

      // ВАЖНО: мы сохраняем вручную по кнопке "Готово"
      submitOnChange: false,
      submitOnClose: false,
    });
  }

  getData() {
    const data = super.getData();

    // Унифицируем доступ к system
    const sys = data.system ?? data.item?.system ?? this.item.system ?? {};
    if (!Number.isFinite(Number(sys.rollDamageDice))) sys.rollDamageDice = 0;
    if (!Number.isFinite(Number(sys.rollSaveDice))) sys.rollSaveDice = 0;
    if (Number(sys.rollDamageDice) === 0 && Number(sys.rollSaveDice) === 0) {
      const legacyMode = String(sys.rollMode ?? "none");
      const legacyDice = Number.isFinite(Number(sys.rollDice))
        ? Number(sys.rollDice)
        : 0;
      if (legacyMode === "damage") sys.rollDamageDice = legacyDice;
      if (legacyMode === "save") sys.rollSaveDice = legacyDice;
    }
    data.system = sys;

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Always allow icon editing (independent of edit mode)
    // Always allow icon editing for abilities
    html
      .find("img[data-edit='img']")
      .off("click.vitruvium-img")
      .on("click.vitruvium-img", (ev) => {
        ev.preventDefault();

        new FilePicker({
          type: "image",
          current: this.item.img,
          callback: async (path) => {
            await this.item.update({ img: path });
          },
        }).browse();
      });

    // Функционал режима редактирования
    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };

    const $name = html.find("input[name='name']");
    const $level = html.find("input[name='system.level']");
    const $cost = html.find("input[name='system.cost']");
    const $desc = html.find("textarea[name='system.description']");
    const $rollDamage = html.find("input[name='system.rollDamageDice']");
    const $rollSave = html.find("input[name='system.rollSaveDice']");
    const $active = html.find("input[name='system.active']");
    const $effectsBtn = html.find("[data-action='edit-effects']");

    // Найдём место для кнопки (или хотя бы header)
    const $headRow = html.find(".v-abilitysheet__headrow");
    const $header = html.find(".v-abilitysheet__header");

    // Кнопка режима редактирования: ищем готовую, иначе создаём
    let $btn = html.find("[data-action='toggle-edit']");
    if (!$btn.length) {
      const btnEl = $(
        `<button type="button" class="v-mini" data-action="toggle-edit">Редактировать</button>`
      );

      // Вставляем рядом с уровнем (если есть headrow), иначе в header
      if ($headRow.length) $headRow.append(btnEl);
      else if ($header.length) $header.append(btnEl);
      else html.find("form").prepend(btnEl);

      $btn = btnEl;
    }

    // Текущее состояние
    let editing = false;

    const setReadonly = (isReadonly) => {
      // readonly: блокирует ввод, но оставляет внешний вид
      $name.prop("readonly", isReadonly);
      $level.prop("readonly", isReadonly);
      $cost.prop("readonly", isReadonly);
      $desc.prop("readonly", isReadonly);
      // косметика (если хочешь — можно использовать в CSS)
      $name.toggleClass("is-readonly", isReadonly);
      $level.toggleClass("is-readonly", isReadonly);
      $cost.toggleClass("is-readonly", isReadonly);
      $desc.toggleClass("is-readonly", isReadonly);
    };

    const enterEdit = () => {
      editing = true;
      $btn.text("Готово");
      setReadonly(false);

      // фокус на описание, чтобы было удобно
      if ($desc.length) $desc.trigger("focus");
    };

    const exitEditAndSave = async () => {
      // Собираем значения из формы
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
      const newDesc = String($desc.val() ?? "");
      const newRollDamageDice = clamp(
        num($rollDamage.val(), num(this.item.system?.rollDamageDice, 0)),
        0,
        20
      );
      const newRollSaveDice = clamp(
        num($rollSave.val(), num(this.item.system?.rollSaveDice, 0)),
        0,
        20
      );

      // Одним апдейтом
      await this.item.update({
        name: newName,
        "system.level": newLevel,
        "system.cost": newCost,
        "system.rollDamageDice": newRollDamageDice,
        "system.rollSaveDice": newRollSaveDice,
        "system.description": newDesc,
      });

      editing = false;
      $btn.text("Редактировать");
      setReadonly(true);
    };

    // Старт: режим чтения
    $btn.text("Редактировать");
    setReadonly(true);

    // Переключение режима
    $btn.on("click", async (ev) => {
      ev.preventDefault();
      if (!editing) {
        enterEdit();
      } else {
        await exitEditAndSave();
      }
    });

    $active.on("change", async (ev) => {
      await this.item.update({ "system.active": ev.currentTarget.checked });
    });

    $effectsBtn.on("click", async (ev) => {
      ev.preventDefault();
      await openEffectsDialog(this.item);
    });

    const clampRollDice = async (input, field) => {
      const value = clamp(num(input.val(), 0), 0, 20);
      await this.item.update({ [field]: value });
    };

    $rollDamage.on("change", async (ev) => {
      await clampRollDice($(ev.currentTarget), "system.rollDamageDice");
    });
    $rollSave.on("change", async (ev) => {
      await clampRollDice($(ev.currentTarget), "system.rollSaveDice");
    });
  }
}
