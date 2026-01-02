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
    data.system = sys;

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };

    const $name = html.find("input[name='name']");
    const $level = html.find("input[name='system.level']");
    const $cost = html.find("input[name='system.cost']");
    const $desc = html.find("textarea[name='system.description']");

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

      // Одним апдейтом
      await this.item.update({
        name: newName,
        "system.level": newLevel,
        "system.cost": newCost,
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
  }
}
