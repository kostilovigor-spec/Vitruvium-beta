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
import { normalizeDamageType } from "../config/damage-types.js";
import { ConditionResolver } from "./condition-resolver.js";
import { replaceStateFromTemplate } from "../state-application.js";

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

    async process(rawAction, input = null) {
        const action = this._normalizeAction(rawAction, input);
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
                return this._healInit(action);

            // ── dot ─────────────────────────────────────────────────
            case "dot":
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


    /** Normalize unified action shape and map legacy fields. */
    _normalizeAction(rawAction, input = null) {
        const action = foundry.utils.deepClone(rawAction ?? {});
        const payload = action.payload ?? {};
        if (!action.type) action.type = String(payload.type ?? "").trim();
        if (!action.state) action.state = String(payload.state ?? "").trim() || "init";
        if (!action.id) action.id = String(payload.id ?? "").trim() || undefined;

        action.actor = action.actor ?? payload.actor;
        action.attacker = action.attacker ?? payload.attacker;
        action.defender = action.defender ?? payload.defender;
        action.weapon = action.weapon ?? payload.weapon;
        action.options = foundry.utils.mergeObject(payload.options ?? {}, action.options ?? {});
        action.value = action.value ?? payload.value;
        action.damageType =
            action.damageType ??
            payload.damageType ??
            payload.damage?.type ??
            action.weapon?.system?.damage?.type;
        action.damageParts = action.damageParts ?? payload.damageParts ?? payload.damage?.parts;

        if (action.state === "await_input" && input) {
            action.defenseType = input.defenseType ?? action.defenseType;
            action.defenseOptions = input.defenseOptions ?? action.defenseOptions ?? {};
            action.defender = input.defender ?? action.defender;
        }
        return action;
    }
    /** Start attack flow. Returns { actionId, preview }. */
    async startAttack(action) {
        return this.process({ ...action, type: "attack", state: "init" });
    }

    /** Продолжает атаку после защиты.
     *  input: { defenseType: "block"|"dodge", defender, defenseOptions? }
     */
    async resumeAttack(actionId, input) {
        return this.process({
            id: actionId,
            type: "attack",
            state: "await_input",
        }, input);
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

    /** resume: defense → resolveFinal → apply → applyStatuses → cleanup */
    async _attackResume(action) {
        const ctxId = action.id ?? action._ctxId;
        const entry = ActionStore.get(ctxId);
        if (!entry?.ctx) throw new Error(`ActionStore: missing action ${ctxId}`);
        const ctx = entry.ctx;

        ctx.action.defender = action.defender ?? ctx.action.defender;
        ctx.action.defenseType = action.defenseType ?? ctx.action.defenseType;
        ctx.action.defenseOptions = action.defenseOptions ?? ctx.action.defenseOptions ?? {};

        await this.stageDefense(ctx);
        await this.stageResolveFinal(ctx);
        await this.stageApply(ctx);
        await this.stageApplyStatuses(ctx);

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
        ctx.damage.parts = [{
            type: normalizeDamageType(
                ctx.action.damageType ?? ctx.action.weapon?.system?.damage?.type ?? "physical",
            ),
            value: weaponDamage,
        }];
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
            const fullMode = this._resolveFullMode(opts.fullMode, globalMods, attackMods);
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
                const fullMode = this._resolveFullMode(opts.fullMode, globalMods, attrMods);
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
            ctx.damage.parts = this._buildDamageParts(action, opts, {
                base,
                includeAttackSuccesses: true,
                attackSuccesses: atkS,
            });
            ctx.computed.weaponDamage = base;

            ctx.state = "await_input";
            ActionStore.set(ctx.id, { ctx, createdAt: Date.now(), userId: game.user?.id });

            return {
                actionId: ctx.id,
                preview: {
                    attackRoll: ctx.rolls.attack,
                    contestRoll: ctx.rolls.contest,
                    attackSuccesses: ctx.computed.attackSuccesses,
                    casterContestSuccesses: ctx.computed.casterContestSuccesses ?? 0,
                    damagePreview: ctx.damage.base,
                }
            };
        }

        // Без защиты — resolve immediately
        if (toNumber(opts.damageBase, 0) > 0 || toNumber(opts.healBase, 0) > 0) {
            await this._abilityResolveImmediate(ctx, opts);
        }

        ctx.state = "resolved";
        return this.buildResult(ctx);
    }

    /** Если ability требовала await_input (defense side) */
    async _abilityResume(action) {
        const ctxId = action.id ?? action._ctxId;
        const entry = ActionStore.get(ctxId);
        if (!entry?.ctx) throw new Error(`ActionStore: missing action ${ctxId}`);
        const ctx = entry.ctx;
        ctx.action.defender = action.defender ?? ctx.action.defender;
        ctx.action.defenseType = action.defenseType ?? ctx.action.defenseType;
        ctx.action.defenseOptions = action.defenseOptions ?? ctx.action.defenseOptions ?? {};
        const opts = ctx.action.options ?? {};

        if (toNumber(opts.damageBase, 0) > 0) {
            await this.stageDefense(ctx);
            await this._abilityResolveFinal(ctx, opts);
            await this.stageApply(ctx);
            await this.stageApplyStatuses(ctx);
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
            ctx.damage.parts = this._buildDamageParts(ctx.action, opts, {
                base,
                includeAttackSuccesses: true,
                attackSuccesses: atkS,
            });
            ctx.computed.damage = ctx.damage.parts.reduce((sum, part) => sum + toNumber(part.value, 0), 0);
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
        const rawParts = this._buildDamageParts(ctx.action, opts, {
            base,
            includeAttackSuccesses: true,
            attackSuccesses: atk,
        });
        ctx.damage.parts = this._scaleDamageParts(
            rawParts,
            dmgOut.damage,
            normalizeDamageType(opts.damageType ?? "physical"),
        );
    }

    // ════════════════════════════════════════════════════════════════
    // ЭТАП 4: PIPELINE — heal / dot
    // ════════════════════════════════════════════════════════════════

    async _healInit(action) {
        const ctx = new ActionContext({ ...action, type: "heal" });
        const actor = action.actor ?? action.attacker ?? action.defender;
        const value = toNumber(action.value ?? action.payload?.value, 0);

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
        const actor = action.actor ?? action.attacker ?? action.defender;
        const value = toNumber(action.value ?? action.payload?.value, 0);

        if (!actor || value <= 0) return this.buildResult(ctx);

        ctx.damage.parts = this._buildDamageParts(action, action.options ?? {}, {
            base: value,
            includeAttackSuccesses: false,
        });

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

        // Определяем тип урона до расчёта
        const damageType = normalizeDamageType(
            ctx.damage.parts?.[0]?.type ??
            ctx.action.damageType ??
            ctx.action.weapon?.system?.damage?.type ??
            "physical",
        );

        const result = DamageResolver.computeWeaponDamage({
            attackSuccesses: atk,
            defenseSuccesses: def,
            weaponDamage,
            armor,
            isBlock,
            damageType
        });

        ctx.computed.damage = result.damage;
        ctx.computed.margin = result.margin;
        ctx.computed.hit = result.hit;
        ctx.computed.compact = result.compact;

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

        // Урон теперь наносится только через кнопку в чате (combat.js вызывает dot)
        // Поэтому здесь мы убираем прямое обновление HP.
        ctx.applied.hpDamage = total;
        ctx.damage.parts = resolvedParts;
    }

    /** Применяет resist/vuln к каждому part, возвращает new parts[] с применёнными значениями */

    _buildDamageParts(action, opts = {}, cfg = {}) {
        const base = Math.max(0, toNumber(cfg.base, 0));
        const includeAttackSuccesses = cfg.includeAttackSuccesses === true;
        const attackSuccesses = includeAttackSuccesses ? Math.max(0, toNumber(cfg.attackSuccesses, 0)) : 0;
        const rawParts = action.damageParts ?? opts.damageParts ?? [];
        if (Array.isArray(rawParts) && rawParts.length > 0) {
            return rawParts.map((part) => ({
                type: normalizeDamageType(part?.type ?? opts.damageType ?? action.damageType ?? "physical"),
                value: Math.max(0, toNumber(part?.value, 0) + attackSuccesses),
            }));
        }
        return [{
            type: normalizeDamageType(opts.damageType ?? action.damageType ?? "physical"),
            value: base + attackSuccesses,
        }];
    }

    _scaleDamageParts(parts, total, fallbackType = "physical") {
        const normalized = Array.isArray(parts) && parts.length
            ? parts.map((part) => ({
                type: normalizeDamageType(part?.type ?? fallbackType),
                value: Math.max(0, toNumber(part?.value, 0)),
            }))
            : [{ type: normalizeDamageType(fallbackType), value: Math.max(0, toNumber(total, 0)) }];

        const target = Math.max(0, Math.round(toNumber(total, 0)));
        const sourceTotal = normalized.reduce((sum, part) => sum + part.value, 0);
        if (target <= 0) return normalized.map((part) => ({ ...part, value: 0 }));
        if (sourceTotal <= 0) return [{ type: normalized[0].type, value: target }];

        const scaled = normalized.map((part) => ({
            type: part.type,
            value: Math.floor((part.value / sourceTotal) * target),
        }));
        const rest = target - scaled.reduce((sum, part) => sum + part.value, 0);
        if (rest > 0) scaled[0].value += rest;
        return scaled;
    }

    _resolveFullMode(userMode, globalMods = {}, localMods = {}) {
        const chosen = String(userMode ?? "normal");
        if (chosen === "adv" || chosen === "dis") return chosen;

        let fullMode = globalMods.fullMode ?? "normal";
        if (fullMode !== "normal") return fullMode;

        const lucky = toNumber(globalMods.lucky, 0) + toNumber(localMods.lucky, 0);
        const unlucky = toNumber(globalMods.unlucky, 0) + toNumber(localMods.unlucky, 0);
        if (lucky > unlucky) return "adv";
        if (unlucky > lucky) return "dis";
        return "normal";
    }

    _applyResistancesToParts(parts, actor) {
        if (!actor || !Array.isArray(parts)) return parts ?? [];

        const effectTotals = Effects.collectEffectTotals(actor);
        const staticResists = new Set(
            (Array.isArray(actor.system?.resistances) ? actor.system.resistances : [])
                .map((type) => normalizeDamageType(type)),
        );
        const staticVulns = new Set(
            (Array.isArray(actor.system?.vulnerabilities) ? actor.system.vulnerabilities : [])
                .map((type) => normalizeDamageType(type)),
        );

        return parts.map(p => {
            const type = normalizeDamageType(p?.type ?? "physical");
            let value = Math.max(0, toNumber(p?.value, 0));

            if (staticResists.has(type)) value *= 0.5;
            if (staticVulns.has(type)) value *= 2;

            const resist = toNumber(effectTotals[`resist.${type}`], 0);
            const vuln = toNumber(effectTotals[`vuln.${type}`], 0);
            const multiplier = Math.max(0, 1 - resist + vuln);
            value *= multiplier;

            return { type, value: Math.round(value) };
        });
    }

    getWeaponDamage(weaponItem, actor) {
        if (weaponItem) {
            return Math.max(
                0,
                Number(
                    weaponItem.system?.damage?.value ??
                    weaponItem.system?.attackBonus ??
                    0,
                ),
            );
        }
        let best = 0;
        for (const it of actor?.items ?? []) {
            if (it.type !== "item") continue;
            if (!it.system?.equipped) continue;
            best = Math.max(
                best,
                Math.max(
                    0,
                    Number(it.system?.damage?.value ?? it.system?.attackBonus ?? 0),
                ),
            );
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

        const fullMode = this._resolveFullMode(options.fullMode, globalMods, attrMods);

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

    // ════════════════════════════════════════════════════════════════
    // STAGE: Apply Statuses — универсальное применение состояний
    // ════════════════════════════════════════════════════════════════

    async stageApplyStatuses(ctx) {
        const { defender, weapon, attacker, options } = ctx.action;
        
        const atk = ctx.computed.attackSuccesses ?? 0;
        const def = ctx.computed.defenseSuccesses ?? 0;
        const margin = ctx.computed.margin ?? (atk - def);
        const hit = ctx.computed.hit ?? false;

        // Получаем токены
        const defenderToken = defender?.getActiveTokens?.()?.[0];
        const defenderTokenUuid = defenderToken?.document?.uuid;
        const attackerToken = attacker?.getActiveTokens?.()?.[0];
        const attackerTokenUuid = attackerToken?.document?.uuid;

        // Собираем все состояния для применения
        let statesToApply = [];

        // 1. Статусы от оружия (weapon.system.contestStates)
        if (weapon?.system?.contestStates) {
            const weaponStates = Array.isArray(weapon.system.contestStates)
                ? weapon.system.contestStates
                : [];
            statesToApply.push(...weaponStates);
        }

        // 2. Статусы от способности (options.contestStates)
        if (options?.contestStates) {
            const abilityStates = Array.isArray(options.contestStates)
                ? options.contestStates
                : [];
            statesToApply.push(...abilityStates);
        }

        if (statesToApply.length === 0) return;

        // Применяем каждый статус в зависимости от режима
        const context = { atk, def, margin };
        
        for (const state of statesToApply) {
            if (!state?.uuid) continue;

            const applyMode = state.applyMode;

            // ── РЕЖИМ: self (на себя) ──────────────────────────────────
            if (applyMode === "self") {
                if (!attacker) continue;
                
                try {
                    await replaceStateFromTemplate(
                        attacker,
                        state.uuid,
                        state.durationRounds,
                        attackerTokenUuid
                    );
                } catch (err) {
                    console.error("ActionProcessor | Error applying self state:", err);
                }
                continue;
            }

            // ── РЕЖИМ: targetNoCheck (без проверки) ─────────────────────
            if (applyMode === "targetNoCheck") {
                if (!defender) continue;
                
                try {
                    await replaceStateFromTemplate(
                        defender,
                        state.uuid,
                        state.durationRounds,
                        defenderTokenUuid
                    );
                } catch (err) {
                    console.error("ActionProcessor | Error applying targetNoCheck state:", err);
                }
                continue;
            }

            // ── РЕЖИМ: margin (при разнице успехов) ─────────────────────
            if (applyMode === "margin") {
                if (!defender) continue;

                // Проверяем условие
                const conditionMet = !state.condition || ConditionResolver.checkCondition(state.condition, context);
                
                if (!conditionMet) continue;

                try {
                    await replaceStateFromTemplate(
                        defender,
                        state.uuid,
                        state.durationRounds,
                        defenderTokenUuid
                    );
                } catch (err) {
                    console.error("ActionProcessor | Error applying margin state:", err);
                }
                continue;
            }

            // ── РЕЖИМ: targetContest (соревнование) ─────────────────────
            // Этот режим НЕ обрабатывается здесь, так как требует отдельного броска цели
            // Он обрабатывается в обработчике кнопки vitruvium-contest
            if (applyMode === "targetContest") {
                continue;
            }
        }
    }
}


