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

  getData() {
    const data = super.getData();

    // Унифицируем доступ к system (в разных версиях Foundry контекст отличается)
    const sys = data.system ?? data.item?.system ?? this.item.system ?? {};
    data.system = sys;

    const desc = String(sys.description ?? "");

    // Готовим HTML для режима "чтение"
    const safe = foundry.utils.escapeHTML(desc).replace(/\n/g, "<br>");
    data.vitruvium = data.vitruvium || {};
    data.vitruvium.descriptionHTML = safe;

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    const view = html.find("[data-role='desc-view']");
    const edit = html.find("[data-role='desc-edit']");
    const btn = html.find("[data-action='toggle-desc']");

    // старт: режим чтения
    edit.hide();
    view.show();
    btn.text("Редактировать описание");

    const setMode = (isEdit) => {
      if (isEdit) {
        view.hide();
        edit.show();
        btn.text("Готово");
        edit.trigger("focus");
      } else {
        edit.hide();
        view.show();
        btn.text("Редактировать описание");
      }
    };

    let editing = false;

    btn.on("click", async (ev) => {
      ev.preventDefault();

      // переключаем режим
      editing = !editing;

      // если выключаем редактирование — сохраняем напрямую в Item
      if (!editing) {
        const text = String(edit.val() ?? "");
        await this.item.update({ "system.description": text });
        // После update Foundry перерендерит лист, и getData() снова заполнит descriptionHTML
        return;
      }

      setMode(true);
    });
  }
}
