import { DiceSystem } from "./dice-system.js";
import { DamageResolver } from "./damage-resolver.js";
import * as Effects from "../effects.js";
import { ActionContext } from "./action-context.js";

export class ActionProcessor {
    async process(action) {
        const ctx = new ActionContext(action);

        switch (action.type) {
            case "attack":
                return this.processAttack(ctx);
        }

        throw new Error(`Unknown action type: ${action.type}`);
    }

    async processAttack(ctx) {
        await this.stageRoll(ctx);
        await this.stageModify(ctx);
        await this.stageResolve(ctx);
        await this.stageApply(ctx);

        return this.buildResult(ctx);
    }

    async stageRoll(ctx) {
        const { attacker, options } = ctx.action;

        const pool = this.getAttackPool(attacker, options);

        const roll = await DiceSystem.rollPool(pool, {
            luck: options.luck,
            unluck: options.unluck,
            fullMode: options.fullMode
        });

        ctx.rolls.attack = roll;
    }

    getAttackPool(actor, options) {
        const base = Number(actor.system.attributes[options.attackAttr]?.value ?? actor.system.attributes[options.attackAttr]) || 0;
        const totals = Effects.collectEffectTotals(actor);
        const mod = Effects.getAttackRollModifiers(totals, {
            attrKey: options.attackAttr,
        });

        return Math.max(1, base + mod.dice); // Placeholder logic, will refine later if needed
    }

    async stageModify(ctx) {
        const { attacker } = ctx.action;
        const totals = Effects.collectEffectTotals(attacker);

        ctx.modifiers.attack = Effects.getAttackRollModifiers(totals, {
            attrKey: ctx.action.options.attackAttr,
        });
    }

    getWeaponDamage(weaponItem, actor) {
        if (weaponItem) return Number(weaponItem.system?.attackBonus || 0);
        let best = 0;
        for (const it of actor.items ?? []) {
            if (it.type !== "item") continue;
            if (!it.system?.equipped) continue;
            best = Math.max(best, Number(it.system.attackBonus || 0));
        }
        return best;
    }

    getArmor(actor) {
        const base = Number(
            actor.system?.attributes?.armor?.value ?? actor.system?.attributes?.armor,
        ) || 0;
        let bonus = 0;
        for (const it of actor.items ?? []) {
            if (it.type !== "item") continue;
            if (!it.system?.equipped) continue;
            bonus += Math.max(0, Math.min(6, Number(it.system.armorBonus || 0)));
        }

        const effectTotals = Effects.collectEffectTotals(actor);
        const armorFromEffects = Effects.getEffectValue(effectTotals, "armorValue");

        return base + bonus + armorFromEffects;
    }

    async stageResolve(ctx) {
        const atk = ctx.rolls.attack.successes;
        const def = 0; // пока без защиты

        const weaponDamage = this.getWeaponDamage(ctx.action.weapon, ctx.action.attacker);
        const armor = this.getArmor(ctx.action.defender);

        const result = DamageResolver.computeWeaponDamage({
            attackSuccesses: atk,
            defenseSuccesses: def,
            weaponDamage,
            armor,
            isBlock: false
        });

        ctx.computed = {
            attackSuccesses: atk,
            defenseSuccesses: def,
            damage: result.damage,
            isCritical: result.crit
        };
    }

    async stageApply(ctx) {
        const { defender } = ctx.action;
        const damage = ctx.computed.damage;

        if (!defender) return;

        const hp = Number(defender.system.attributes?.hp?.value) || 0;
        const newHp = Math.max(0, hp - damage);

        await defender.update({
            "system.attributes.hp.value": newHp
        }, {
            vitruvium: {
                damage: damage,
                source: "attack"
            }
        });

        ctx.applied.hpDamage = damage;
    }

    buildResult(ctx) {
        return {
            success: true,
            rolls: ctx.rolls,
            computed: ctx.computed,
            applied: ctx.applied
        };
    }
}
