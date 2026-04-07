export class ActionContext {
    constructor(action) {
        this.action = action;
        this.rolls = {};
        this.modifiers = {};
        this.computed = {};
        this.applied = {};
    }
}
