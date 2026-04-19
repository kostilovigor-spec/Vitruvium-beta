export class ActionContext {
    constructor(action) {
        this.id = foundry.utils.randomID();
        this.action = action;
        this.state = "pending_defense"; // "pending_defense" | "resolved"
        this.rolls = {};
        this.modifiers = {};
        this.computed = {};
        this.applied = {};

        // Структура урона: base + разбивка по типам
        this.damage = {
            base: 0,
            parts: [] // [{ type: "physical", value: number }, ...]
        };
    }
}
