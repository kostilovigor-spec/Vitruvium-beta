// systems/Vitruvium/module/dice/dv-die.js

export class VitruviumDie extends Die {
  /** @override */
  static DENOMINATION = "V";

  constructor(termData = {}) {
    // Принудительно задаём faces ДО super()
    termData.faces = 6;

    super(termData);

    // Дублируем для полной совместимости с v13
    this.faces = 6;
  }

  /** @override */
  get denomination() {
    return "V";
  }

  /** @override */
  getResultLabel(result) {
    // Можно кастомизировать позже (иконки и т.п.)
    return String(result);
  }
}
