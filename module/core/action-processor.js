import { DiceSystem } from "./dice-system.js";
import { DamageResolver } from "./damage-resolver.js";
import * as Effects from "../effects.js";
import { ActionContext } from "./action-context.js";
import { renderFaces } from "../rolls.js";
import { escapeHtml } from "../utils/string.js";
import { chatVisibilityData } from "../chat-visibility.js";
import { genericRollDialog } from "../combat.js";

export class ActionProcessor {
    async process(action) {
        const ctx = new ActionContext(action);

        const needsPrompt = ["attribute", "luck", "bonus_dice"].includes(action.type) && !action.options?.fastForward;
        if (needsPrompt) {
            const result = await this.stagePrompt(ctx);
            if (!result) return { success: false, cancelled: true };
            action.options = foundry.utils.mergeObject(action.options || {}, result);
        }

        switch (action.type) {
            case "attack":
                return this.processAttack(ctx);
            case "ability":
                return this.processAbility(ctx);
            case "attribute":
                return this.processAttribute(ctx);
            case "luck":
                return this.processLuck(ctx);
            case "bonus_dice":
                return this.processBonusDice(ctx);
            case "apply_dot":
                return this.processApplyDot(ctx);
        }

        throw new Error(`Unknown action type: ${action.type}`);
    }

    async processAttack(ctx) {
        await this.stageRoll(ctx);
        await this.stageModify(ctx);
        await this.stageResolve(ctx);
        // stageApply removed — damage is applied via GM chat button (same as abilities)
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

        return Math.max(1, base + mod.dice);
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
        if (!actor) return 0;
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
            weaponDamage: weaponDamage,
            damage: result.damage,
            margin: result.margin
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

    async processApplyDot(ctx) {
        const { actor, value } = ctx.action;
        if (!actor) return;

        const hp = Number(actor.system.attributes?.hp?.value) || 0;
        const newHp = Math.max(0, hp - value);

        await actor.update({
            "system.attributes.hp.value": newHp
        }, {
            vitruvium: {
                damage: value,
                source: "dot"
            }
        });

        ctx.applied.hpDamage = value;
        return this.buildResult(ctx);
    }

    async processAbility(ctx) {
        const { attacker, options } = ctx.action;
        const effectTotals = Effects.collectEffectTotals(attacker);
        const globalMods = Effects.getGlobalRollModifiers(effectTotals);

        if (options.needsAttackRoll && options.attackAttr) {
            const attackMods = Effects.getAttackRollModifiers(effectTotals, {
                attrKey: options.attackAttr,
            });
            const baseAttr = Effects.getEffectiveAttribute(
                attacker.system?.attributes,
                options.attackAttr,
                effectTotals
            );
            const pool = Math.max(1, Math.min(20, baseAttr + attackMods.dice + globalMods.dice + (options.extraDice || 0)));
            const luck = (options.luck || 0) + globalMods.adv + attackMods.adv;
            const unluck = (options.unluck || 0) + globalMods.dis + attackMods.dis;
            let fullMode = globalMods.fullMode;
            if (fullMode === "normal") {
                const totalLucky = globalMods.lucky + attackMods.lucky;
                const totalUnlucky = globalMods.unlucky + attackMods.unlucky;
                if (totalLucky > totalUnlucky) fullMode = "adv";
                else if (totalUnlucky > totalLucky) fullMode = "dis";
            }

            ctx.rolls.attack = await DiceSystem.rollPool(pool, { luck, unluck, fullMode });
            ctx.computed.attackSuccesses = ctx.rolls.attack.successes;
        }

        if (options.doContestRoll && options.contestCasterAttr) {
            if (options.needsAttackRoll && options.attackAttr === options.contestCasterAttr && ctx.rolls.attack) {
                ctx.rolls.contest = ctx.rolls.attack;
                ctx.computed.casterContestSuccesses = ctx.rolls.attack.successes;
            } else {
                const attrMods = Effects.getAttributeRollModifiers(effectTotals, options.contestCasterAttr);
                const baseAttr = Effects.getEffectiveAttribute(
                    attacker.system?.attributes,
                    options.contestCasterAttr,
                    effectTotals
                );
                const pool = Math.max(1, Math.min(20, baseAttr + attrMods.dice + globalMods.dice));
                let fullMode = globalMods.fullMode;
                if (fullMode === "normal") {
                    const totalLucky = globalMods.lucky + attrMods.lucky;
                    const totalUnlucky = globalMods.unlucky + attrMods.unlucky;
                    if (totalLucky > totalUnlucky) fullMode = "adv";
                    else if (totalUnlucky > totalLucky) fullMode = "dis";
                }

                ctx.rolls.contest = await DiceSystem.rollPool(pool, {
                    luck: globalMods.adv + attrMods.adv,
                    unluck: globalMods.dis + attrMods.dis,
                    fullMode
                });
                ctx.computed.casterContestSuccesses = ctx.rolls.contest.successes;
            }
        }

        return this.buildResult(ctx);
    }

    async processAttribute(ctx) {
        const { attacker, options } = ctx.action;
        const pool = options.pool ?? this.getAttributePool(attacker, options.attrKey);

        const effectTotals = Effects.collectEffectTotals(attacker);
        const attrMods = Effects.getAttributeRollModifiers(effectTotals, options.attrKey);
        const globalMods = Effects.getGlobalRollModifiers(effectTotals);

        let fullMode = globalMods.fullMode;
        if (fullMode === "normal") {
            const totalLucky = globalMods.lucky + attrMods.lucky;
            const totalUnlucky = globalMods.unlucky + attrMods.unlucky;
            if (totalLucky > totalUnlucky) fullMode = "adv";
            else if (totalUnlucky > totalLucky) fullMode = "dis";
        }

        ctx.rolls.check = await DiceSystem.rollPool(pool, {
            luck: (options.luck || 0) + globalMods.adv + attrMods.adv,
            unluck: (options.unluck || 0) + globalMods.dis + attrMods.dis,
            fullMode,
            extraDice: options.extraDice || 0
        });

        ctx.computed.successes = ctx.rolls.check.successes;
        await this.stageEmit(ctx, options.attrKey.toUpperCase(), "Проверка атрибута");
        return this.buildResult(ctx);
    }

    getAttributePool(actor, attrKey) {
        const effectTotals = Effects.collectEffectTotals(actor);
        const base = Effects.getEffectiveAttribute(actor.system?.attributes, attrKey, effectTotals);
        const attrMods = Effects.getAttributeRollModifiers(effectTotals, attrKey);
        const globalMods = Effects.getGlobalRollModifiers(effectTotals);

        return Math.max(1, Math.min(20, base + attrMods.dice + globalMods.dice));
    }

    async processLuck(ctx) {
        const { attacker, options } = ctx.action;
        ctx.rolls.check = await DiceSystem.rollPool(options.pool || 1, {
            luck: options.luck,
            unluck: options.unluck,
            fullMode: options.fullMode,
            extraDice: options.extraDice
        });
        ctx.computed.successes = ctx.rolls.check.successes;
        await this.stageEmit(ctx, "Удача", "Бросок на удачу");
        return this.buildResult(ctx);
    }

    async processBonusDice(ctx) {
        const { options } = ctx.action;
        const pool = Math.max(1, Math.min(20, options.pool || 1));
        ctx.rolls.check = await DiceSystem.rollPool(pool, {
            luck: options.luck,
            unluck: options.unluck,
            fullMode: options.fullMode,
            extraDice: options.extraDice
        });
        ctx.computed.successes = ctx.rolls.check.successes;
        await this.stageEmit(ctx, "Бонусные кубики", `Пулл: ${pool}`);
        return this.buildResult(ctx);
    }

    async stagePrompt(ctx) {
        const { type, options, attacker } = ctx.action;
        let title = "Бросок";
        let pool = 1;
        let showPool = false;

        switch (type) {
            case "attribute":
                title = `Проверка: ${options.attrKey.toUpperCase()}`;
                pool = this.getAttributePool(attacker, options.attrKey);
                break;
            case "luck":
                title = "Бросок на удачу";
                pool = 1;
                break;
            case "bonus_dice":
                title = "Бонусные кубики";
                pool = options.pool || 1;
                showPool = true;
                break;
        }

        return genericRollDialog({ title, pool, showPool, actor: attacker });
    }

    async stageEmit(ctx, title, sub) {
        const roll = ctx.rolls.check;
        if (!roll) return;

        const content = `
            <div class="v-card v-card--roll">
                <div class="v-card__header">
                    <div class="v-card__info">
                        <div class="v-card__title">${escapeHtml(ctx.action.attacker?.name || "Актёр")}</div>
                        <div class="v-card__sub">${escapeHtml(title)} <span class="v-card__mode">${escapeHtml(sub)}</span></div>
                    </div>
                </div>
                <div class="v-card__body">
                    <div class="v-card__result">
                        <span class="v-label">Успехи</span>
                        <span class="v-value">${ctx.computed.successes}</span>
                    </div>
                    ${renderFaces(roll.results)}
                </div>
            </div>
        `;

        await ChatMessage.create({
            ...chatVisibilityData(),
            content,
            speaker: ChatMessage.getSpeaker({ actor: ctx.action.attacker }),
            rolls: roll.rolls || []
        });
    }
}
