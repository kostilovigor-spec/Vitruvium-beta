import { DiceSystem } from "./dice-system.js";
import { DamageResolver } from "./damage-resolver.js";
import * as Effects from "../effects.js";
import { ActionContext } from "./action-context.js";
import { ActionStore } from "./action-store.js";
import { renderFaces } from "../rolls.js";
import { escapeHtml } from "../utils/string.js";
import { chatVisibilityData } from "../chat-visibility.js";
import { genericRollDialog } from "../combat.js";
import { clamp, toNumber } from "../utils/number.js";

// ──────────────────────────────────────────────────────────────────
// Утилиты (локальные, не зависят от FoundryVTT Document API)
// ──────────────────────────────────────────────────────────────────

function getArmorTotal(actor) {
    const base = toNumber(
        actor.system?.attributes?.armor?.value ?? actor.system?.attributes?.armor,
        0,
    );
    let bonus = 0;
    for (const it of actor.items ?? []) {
        if (it.type !== "item") continue;
        if (!it.system?.equipped) continue;
        bonus += clamp(toNumber(it.system.armorBonus, 0), 0, 6);
    }
    const effectTotals = Effects.collectEffectTotals(actor);
    const armorFromEffects = Effects.getEffectValue(effectTotals, "armorValue");
    return base + bonus + armorFromEffects;
}

// ──────────────────────────────────────────────────────────────────
// ActionProcessor — единственный центр логики боёвки
// ──────────────────────────────────────────────────────────────────

export class ActionProcessor {

    // ════════════════════════════════════════════════════════════════
    // ЭТАП 1: Универсальный entry point — state-машина
    // Формат action: { type, state?, payload?, attacker, ... }
    // state: "init" | "await_input" | "resolved"
    // ════════════════════════════════════════════════════════════════

    async process(action) {
        const state = action.state ?? "init";

        // Промпт для dice-бросков (не меняет state-машину)
        const needsPrompt = ["attribute", "luck", "bonus_dice"].includes(action.type)
            && !action.options?.fastForward
            && state === "init";

        if (needsPrompt) {
            const ctx = new ActionContext(action);
            const result = await this.stagePrompt(ctx);
            if (!result) return { success: false, cancelled: true };
            action.options = foundry.utils.mergeObject(action.options || {}, result);
        }

        switch (action.type) {
            // ── attack ──────────────────────────────────────────────
            case "attack":
                if (state === "init") return this._attackInit(action);
                if (state === "await_input") return this._attackResume(action);
                throw new Error(`attack: недопустимый state "${state}"`);

            // ── ability ─────────────────────────────────────────────
            case "ability":
                if (state === "init") return this._abilityInit(action);
                if (state === "await_input") return this._abilityResume(action);
                throw new Error(`ability: недопустимый state "${state}"`);

            // ── heal ────────────────────────────────────────────────
            case "heal":
            case "apply_heal":
                return this._healInit(action);

            // ── dot ─────────────────────────────────────────────────
            case "dot":
            case "apply_dot":
                return this._dotInit(action);

            // ── attribute / luck / bonus_dice ───────────────────────
            case "attribute":
                return this.processAttribute(new ActionContext(action));
            case "luck":
                return this.processLuck(new ActionContext(action));
            case "bonus_dice":
                return this.processBonusDice(new ActionContext(action));
        }

        throw new Error(`ActionProcessor: неизвестный тип "${action.type}"`);
    }

    // ════════════════════════════════════════════════════════════════
    // ЭТАП 3: Thin wrappers — startAttack / resumeAttack
    // ════════════════════════════════════════════════════════════════

    /** Инициирует атаку. Возвращает { actionId, preview }. */
    async startAttack(action) {
        return this.process({ ...action, type: "attack", state: "init" });
    }

    /** Продолжает атаку после защиты.
     *  input: { defenseType: "block"|"dodge", defender, defenseOptions? }
     */
    async resumeAttack(actionId, input) {
        const entry = ActionStore.get(actionId);
        if (!entry) throw new Error(`ActionStore: нет активного действия ${actionId}`);
        const { ctx } = entry;
        if (ctx.state === "resolved") throw new Error(`ActionStore: действие ${actionId} уже завершено`);

        // Дополняем контекст данными защитника
        ctx.action.defender = input.defender ?? ctx.action.defender;
        ctx.action.defenseType = input.defenseType;
        ctx.action.defenseOptions = input.defenseOptions ?? {};

        return this.process({
            ...ctx.action,
            type: ctx.action.type ?? "attack",
            state: "await_input",
            _ctxId: actionId
        });
    }

    // ════════════════════════════════════════════════════════════════
    // ЭТАП 4: PIPELINE — attack
    // ════════════════════════════════════════════════════════════════

    /** init: roll → modify → resolveAttackOnly → save → return preview */
    async _attackInit(action) {
        const ctx = new ActionContext({ ...action, type: "attack" });

        await this.stageRollAttack(ctx);
        await this.stageModify(ctx);
        await this._attackResolveOnly(ctx);

        ctx.state = "await_input";
        ActionStore.set(ctx.id, { ctx, createdAt: Date.now(), userId: game.user?.id });

        return {
            actionId: ctx.id,
            preview: {
                attackRoll: ctx.rolls.attack,
                attackSuccesses: ctx.computed.attackSuccesses,
                damagePreview: ctx.damage.base,
            }
        };
    }

    /** resume: defense → resolveFinal → apply → cleanup */
    async _attackResume(action) {
        const ctxId = action._ctxId;
        const entry = ActionStore.get(ctxId);
        const ctx = entry?.ctx ?? new ActionContext(action);

        await this.stageDefense(ctx);
        await this.stageResolveFinal(ctx);
        await this.stageApply(ctx);

        ctx.state = "resolved";
        ActionStore.delete(ctxId);

        return this.buildResult(ctx);
    }

    /** Считает attackSuccesses и damage.base, НЕ считает финальный урон */
    async _attackResolveOnly(ctx) {
        const atk = ctx.rolls.attack.successes;
        const weaponDamage = this.getWeaponDamage(ctx.action.weapon, ctx.action.attacker);

        ctx.computed.attackSuccesses = atk;
        ctx.computed.weaponDamage = weaponDamage;
        ctx.damage.base = weaponDamage;
        ctx.damage.parts = [{ type: ctx.action.damageType ?? "physical", value: weaponDamage }];
    }

    // ════════════════════════════════════════════════════════════════
    // ЭТАП 4: PIPELINE — ability
    // ════════════════════════════════════════════════════════════════

    /** init: roll → [если needsDefense → сохранить, await_input] | [иначе → resolve → return] */
    async _abilityInit(action) {
        const ctx = new ActionContext({ ...action, type: "ability" });
        const opts = action.options ?? {};

        const effectTotals = Effects.collectEffectTotals(action.attacker);
        const globalMods = Effects.getGlobalRollModifiers(effectTotals);

        // Rol атаки (если есть)
        if (opts.needsAttackRoll && opts.attackAttr) {
            const attackMods = Effects.getAttackRollModifiers(effectTotals, { attrKey: opts.attackAttr });
            const baseAttr = Effects.getEffectiveAttribute(action.attacker.system?.attributes, opts.attackAttr, effectTotals);
            const pool = Math.max(1, Math.min(20, baseAttr + attackMods.dice + globalMods.dice + (opts.extraDice || 0)));
            const luck = (opts.luck || 0) + globalMods.adv + attackMods.adv;
            const unluck = (opts.unluck || 0) + globalMods.dis + attackMods.dis;
            let fullMode = globalMods.fullMode;
            if (fullMode === "normal") {
                const tl = globalMods.lucky + attackMods.lucky;
                const tu = globalMods.unlucky + attackMods.unlucky;
                if (tl > tu) fullMode = "adv";
                else if (tu > tl) fullMode = "dis";
            }
            ctx.rolls.attack = await DiceSystem.rollPool(pool, { luck, unluck, fullMode });
            ctx.computed.attackSuccesses = ctx.rolls.attack.successes;
        }

        // Бросок contest (caster side)
        if (opts.doContestRoll && opts.contestCasterAttr) {
            if (opts.needsAttackRoll && opts.attackAttr === opts.contestCasterAttr && ctx.rolls.attack) {
                ctx.rolls.contest = ctx.rolls.attack;
                ctx.computed.casterContestSuccesses = ctx.rolls.attack.successes;
            } else {
                const attrMods = Effects.getAttributeRollModifiers(effectTotals, opts.contestCasterAttr);
                const baseAttr = Effects.getEffectiveAttribute(action.attacker.system?.attributes, opts.contestCasterAttr, effectTotals);
                const pool = Math.max(1, Math.min(20, baseAttr + attrMods.dice + globalMods.dice));
                let fullMode = globalMods.fullMode;
                if (fullMode === "normal") {
                    const tl = globalMods.lucky + attrMods.lucky;
                    const tu = globalMods.unlucky + attrMods.unlucky;
                    if (tl > tu) fullMode = "adv";
                    else if (tu > tl) fullMode = "dis";
                }
                ctx.rolls.contest = await DiceSystem.rollPool(pool, {
                    luck: globalMods.adv + attrMods.adv,
                    unluck: globalMods.dis + attrMods.dis,
                    fullMode
                });
                ctx.computed.casterContestSuccesses = ctx.rolls.contest.successes;
            }
        }

        // Если способность требует ответной защиты (hasDamage && defenseFlow)
        if (opts.needsDefense) {
            // Заполняем damage.parts заранее (для preview)
            const base = toNumber(opts.damageBase, 0);
            const atkS = ctx.computed.attackSuccesses ?? 0;
            ctx.damage.base = base;
            ctx.damage.parts = [{ type: opts.damageType ?? "physical", value: base + atkS }];
            ctx.computed.weaponDamage = base;

            ctx.state = "await_input";
            ActionStore.set(ctx.id, { ctx, createdAt: Date.now(), userId: game.user?.id });

            return {
                actionId: ctx.id,
                preview: {
                    attackRoll: ctx.rolls.attack,
                    contestRoll: ctx.rolls.contest,
                    attackSuccesses: ctx.computed.attackSuccesses,
                    casterContestSuccesses: ctx.computed.casterContestSuccesses,
                    damagePreview: ctx.damage.base,
                }
            };
        }

        // Без защиты — resolve immediately
        if (opts.damageBase > 0 || opts.healBase > 0) {
            await this._abilityResolveImmediate(ctx, opts);
        }

        ctx.state = "resolved";
        return this.buildResult(ctx);
    }

    /** Если ability требовала await_input (defense side) */
    async _abilityResume(action) {
        const ctxId = action._ctxId;
        const entry = ActionStore.get(ctxId);
        const ctx = entry?.ctx ?? new ActionContext(action);
        const opts = ctx.action.options ?? {};

        // Защита (если damageBase задан)
        if (toNumber(opts.damageBase, 0) > 0) {
            await this.stageDefense(ctx);
            await this._abilityResolveFinal(ctx, opts);
            await this.stageApply(ctx);
        }

        ctx.state = "resolved";
        ActionStore.delete(ctxId);
        return this.buildResult(ctx);
    }

    /** Resolve без защиты (ability, вариант 1) */
    async _abilityResolveImmediate(ctx, opts) {
        const atkS = ctx.computed.attackSuccesses ?? 0;
        if (opts.damageBase > 0) {
            const base = toNumber(opts.damageBase, 0);
            ctx.damage.base = base;
            ctx.damage.parts = [{ type: opts.damageType ?? "physical", value: base + atkS }];
            ctx.computed.damage = base + atkS;
        }
        if (opts.healBase > 0) {
            ctx.computed.heal = toNumber(opts.healBase, 0) + atkS;
        }
    }

    /** Resolve с учётом защиты (ability, вариант 2) */
    async _abilityResolveFinal(ctx, opts) {
        const atk = ctx.computed.attackSuccesses ?? 0;
        const def = ctx.computed.defenseSuccesses ?? 0;
        const base = toNumber(opts.damageBase, 0);

        const dmgOut = DamageResolver.computeAbilityDamage({
            weaponDamage: base,
            attackSuccesses: atk,
            defenseSuccesses: def,
        });

        ctx.computed.damage = dmgOut.damage;
        ctx.computed.margin = dmgOut.margin;
        ctx.computed.hit = dmgOut.hit;
        ctx.computed.compact = dmgOut.compact;
        ctx.damage.parts = [{ type: opts.damageType ?? "physical", value: dmgOut.damage }];
    }

    // ════════════════════════════════════════════════════════════════
    // ЭТАП 4: PIPELINE — heal / dot
    // ════════════════════════════════════════════════════════════════

    async _healInit(action) {
        const ctx = new ActionContext({ ...action, type: "heal" });
        const actor = action.actor ?? action.attacker;
        const value = toNumber(action.value, 0);

        if (!actor || value <= 0) return this.buildResult(ctx);

        const hp = Number(actor.system?.attributes?.hp?.value) || 0;
        const hpMax = Number(actor.system?.attributes?.hp?.max) || hp;
        const newHp = Math.min(hpMax, hp + value);

        await actor.update(
            { "system.attributes.hp.value": newHp },
            { vitruvium: { heal: value, source: "heal" } }
        );

        ctx.applied.hpHeal = value;
        ctx.state = "resolved";
        return this.buildResult(ctx);
    }

    async _dotInit(action) {
        const ctx = new ActionContext({ ...action, type: "dot" });
        const actor = action.actor ?? action.attacker;
        const value = toNumber(action.value, 0);

        if (!actor || value <= 0) return this.buildResult(ctx);

        ctx.damage.parts = [{ type: action.damageType ?? "physical", value }];

        // Применяем resist/vuln к DoT если есть тип
        const finalValue = this._applyResistancesToParts(ctx.damage.parts, actor)
            .reduce((s, p) => s + p.value, 0);

        const hp = Number(actor.system?.attributes?.hp?.value) || 0;
        const newHp = Math.max(0, hp - finalValue);

        await actor.update(
            { "system.attributes.hp.value": newHp },
            { vitruvium: { damage: finalValue, types: ctx.damage.parts, source: "dot" } }
        );

        ctx.applied.hpDamage = finalValue;
        ctx.state = "resolved";
        return this.buildResult(ctx);
    }

    // ════════════════════════════════════════════════════════════════
    // STAGE METHODS
    // ════════════════════════════════════════════════════════════════

    async stageRollAttack(ctx) {
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
        const base = Number(
            actor.system.attributes[options.attackAttr]?.value ??
            actor.system.attributes[options.attackAttr]
        ) || 0;
        const totals = Effects.collectEffectTotals(actor);
        const mod = Effects.getAttackRollModifiers(totals, { attrKey: options.attackAttr });
        return Math.max(1, base + mod.dice);
    }

    async stageModify(ctx) {
        const { attacker } = ctx.action;
        const totals = Effects.collectEffectTotals(attacker);
        ctx.modifiers.attack = Effects.getAttackRollModifiers(totals, {
            attrKey: ctx.action.options.attackAttr,
        });
    }

    async stageDefense(ctx) {
        const { defender, defenseType, defenseOptions = {} } = ctx.action;
        if (!defender) {
            ctx.rolls.defense = null;
            ctx.computed.defenseSuccesses = 0;
            ctx.computed.isBlock = false;
            return;
        }

        const isBlock = defenseType === "block";
        ctx.computed.isBlock = isBlock;

        const effectTotals = Effects.collectEffectTotals(defender);
        const defMods = Effects.getAttributeRollModifiers
            ? Effects.getAttributeRollModifiers(effectTotals, isBlock ? "combat" : "movement")
            : { dice: 0, adv: 0, dis: 0 };
        const globalMods = Effects.getGlobalRollModifiers(effectTotals);

        const baseAttr = Effects.getEffectiveAttribute(
            defender.system?.attributes,
            isBlock ? "combat" : "movement",
            effectTotals
        );

        const extraDice = toNumber(defenseOptions.extraDice, 0);
        const pool = Math.max(1, baseAttr + (defMods.dice || 0) + globalMods.dice + extraDice);
        const luck = toNumber(defenseOptions.luck, 0) + (defMods.adv || 0) + globalMods.adv;
        const unluck = toNumber(defenseOptions.unluck, 0) + (defMods.dis || 0) + globalMods.dis;
        const fullMode = defenseOptions.fullMode ?? globalMods.fullMode ?? "normal";

        const roll = await DiceSystem.rollPool(pool, { luck, unluck, fullMode });
        ctx.rolls.defense = roll;
        ctx.computed.defenseSuccesses = roll.successes;
    }

    async stageResolveFinal(ctx) {
        const atk = ctx.computed.attackSuccesses ?? ctx.rolls.attack?.successes ?? 0;
        const def = ctx.computed.defenseSuccesses ?? 0;
        const weaponDamage = ctx.computed.weaponDamage ?? this.getWeaponDamage(ctx.action.weapon, ctx.action.attacker);
        const armor = this.getArmor(ctx.action.defender);
        const isBlock = ctx.computed.isBlock ?? false;

        const result = DamageResolver.computeWeaponDamage({
            attackSuccesses: atk,
            defenseSuccesses: def,
            weaponDamage,
            armor,
            isBlock
        });

        ctx.computed.damage = result.damage;
        ctx.computed.margin = result.margin;
        ctx.computed.hit = result.hit;
        ctx.computed.compact = result.compact;

        // Формируем damage.parts (тип берём из предыдущего шага или "physical")
        const damageType = ctx.damage.parts?.[0]?.type ?? ctx.action.damageType ?? "physical";
        ctx.damage.parts = [{ type: damageType, value: result.damage }];
    }

    // ════════════════════════════════════════════════════════════════
    // ЭТАПЫ 7+8: stageApply — применяет resist/vuln к каждому part
    // ЕДИНСТВЕННОЕ место где меняется HP
    // ════════════════════════════════════════════════════════════════

    async stageApply(ctx) {
        const { defender } = ctx.action;
        if (!defender) return;

        // Применяем resistances / vulnerabilities к каждому типу урона
        const resolvedParts = this._applyResistancesToParts(ctx.damage.parts, defender);
        const total = resolvedParts.reduce((s, p) => s + toNumber(p.value, 0), 0);

        if (total <= 0) return;

        // Урон теперь наносится только через кнопку в чате (combat.js вызывает apply_dot)
        // Поэтому здесь мы убираем прямое обновление HP.
        ctx.applied.hpDamage = total;
        ctx.damage.parts = resolvedParts;
    }

    /** Применяет resist/vuln к каждому part, возвращает new parts[] с применёнными значениями */
    _applyResistancesToParts(parts, actor) {
        if (!actor || !Array.isArray(parts)) return parts ?? [];

        const effectTotals = Effects.collectEffectTotals(actor);
        return parts.map(p => {
            const resist = toNumber(effectTotals[`resist.${p.type}`], 0);
            const vuln = toNumber(effectTotals[`vuln.${p.type}`], 0);
            const multiplier = Math.max(0, 1 - resist + vuln);
            return { type: p.type, value: Math.round(toNumber(p.value, 0) * multiplier) };
        });
    }

    getWeaponDamage(weaponItem, actor) {
        if (weaponItem) return Number(weaponItem.system?.attackBonus || 0);
        let best = 0;
        for (const it of actor?.items ?? []) {
            if (it.type !== "item") continue;
            if (!it.system?.equipped) continue;
            best = Math.max(best, Number(it.system.attackBonus || 0));
        }
        return best;
    }

    getArmor(actor) {
        if (!actor) return 0;
        return getArmorTotal(actor);
    }

    buildResult(ctx) {
        return {
            success: true,
            rolls: ctx.rolls,
            computed: ctx.computed,
            applied: ctx.applied,
            damage: ctx.damage,
            state: ctx.state
        };
    }

    // ════════════════════════════════════════════════════════════════
    // Attribute / Luck / BonusDice — без изменений
    // ════════════════════════════════════════════════════════════════

    async processAttribute(ctx) {
        const { attacker, options } = ctx.action;
        const pool = options.pool ?? this.getAttributePool(attacker, options.attrKey);
        const effectTotals = Effects.collectEffectTotals(attacker);
        const attrMods = Effects.getAttributeRollModifiers(effectTotals, options.attrKey);
        const globalMods = Effects.getGlobalRollModifiers(effectTotals);

        let fullMode = globalMods.fullMode;
        if (fullMode === "normal") {
            const tl = globalMods.lucky + attrMods.lucky;
            const tu = globalMods.unlucky + attrMods.unlucky;
            if (tl > tu) fullMode = "adv";
            else if (tu > tl) fullMode = "dis";
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
        const { options } = ctx.action;
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
