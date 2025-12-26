export class VitruviumItemSheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "item"],
      template: "systems/Vitruvium/templates/item/item-sheet.hbs",
      width: 520,
      height: 600,
      submitOnChange: true,
      submitOnClose: true,
    });
  }

  activateListeners(html) {
    super.activateListeners(html);

    const desc = html.find("textarea[name='system.description']");
    if (!desc.length) return;

    // Храним последнее значение, чтобы не спамить update
    let lastSaved = String(this.document.system?.description ?? "");
    let timer = null;

    const saveNow = async () => {
      const value = String(desc.val() ?? "");
      if (value === lastSaved) return;
      lastSaved = value;
      await this.document.update({ "system.description": value });
    };

    // Быстрое сохранение: почти сразу (30мс), чтобы не проиграть перерендерам
    const scheduleFast = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        saveNow().catch(console.error);
      }, 30);
    };

    // Пока печатают — сохраняем быстро
    desc.on("input", scheduleFast);

    // Blur/change — тоже
    desc.on("blur", scheduleFast);
    desc.on("change", scheduleFast);

    // Перед любым нажатием кнопок — форсим сохранение
    html.find("button").on("mousedown", async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await saveNow();
    });

    // Запомним функцию принудительного сохранения для close()
    this._vitruviumForceSave = async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await saveNow();
    };
  }

  async close(options) {
    // Самое важное: при закрытии листа — всегда сохранить текущий текст
    if (this._vitruviumForceSave) {
      await this._vitruviumForceSave();
    }
    return super.close(options);
  }
}
