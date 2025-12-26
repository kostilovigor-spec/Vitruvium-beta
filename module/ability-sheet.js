export class VitruviumAbilitySheet extends ItemSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["vitruvium", "sheet", "item"],
      template: "systems/vitruvium/templates/item/ability-sheet.hbs",
      width: 520,
      height: 520,
      submitOnChange: true,
      submitOnClose: true,
    });
  }

  getData() {
    const data = super.getData();

    const sys = data.system ?? this.item.system ?? {};
    let cost = Number(sys.cost);
    if (Number.isNaN(cost)) cost = 1;

    data.vitruvium = {
      cost: Math.min(Math.max(cost, 0), 99),
      description: String(sys.description ?? ""),
    };

    return data;
  }

  activateListeners(html) {
    super.activateListeners(html);

    const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
    const num = (v, d) => {
      const x = Number(v);
      return Number.isNaN(x) ? d : x;
    };

    html.find("[data-action='cost-inc']").on("click", async (ev) => {
      ev.preventDefault();
      const sys = this.item.system ?? {};
      const current = clamp(num(sys.cost, 1), 0, 99);
      await this.item.update({ "system.cost": current + 1 });
    });

    html.find("[data-action='cost-dec']").on("click", async (ev) => {
      ev.preventDefault();
      const sys = this.item.system ?? {};
      const current = clamp(num(sys.cost, 1), 0, 99);
      await this.item.update({ "system.cost": clamp(current - 1, 0, 99) });
    });
  }
}
