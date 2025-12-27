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

    html.find("[data-action='edit-description']").on("click", async (ev) => {
      ev.preventDefault();

      const current = String(this.document.system?.description ?? "");

      const esc = (s) =>
        String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");

      const content = `
        <div class="form-group">
          <label>Описание</label>
          <textarea id="vitruvium-desc" style="width:100%; min-height:260px; resize:vertical;">${esc(
            current
          )}</textarea>
        </div>
      `;

      new Dialog({
        title: `Описание: ${this.document.name}`,
        content,
        buttons: {
          save: {
            label: "Сохранить",
            callback: async (dlgHtml) => {
              const value = dlgHtml.find("#vitruvium-desc").val();
              await this.document.update({
                "system.description": String(value ?? ""),
              });
            },
          },
          cancel: { label: "Отмена" },
        },
        default: "save",
      }).render(true);
    });
  }
}
