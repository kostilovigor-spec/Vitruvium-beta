function isCritical(atk, def) {
    return atk >= 2 && atk >= 2 * def && atk - def >= 2;
}

function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
}

/**
 * @param {Object} options
 * @param {number} options.attackSuccesses
 * @param {number} options.defenseSuccesses
 * @param {number} options.weaponDamage
 * @param {number} options.armor
 * @param {boolean} options.isBlock
 */
function computeWeaponDamage({
    attackSuccesses,
    defenseSuccesses,
    weaponDamage,
    armor,
    isBlock
}) {
    const atk = num(attackSuccesses, 0);
    const def = num(defenseSuccesses, 0);
    const base = num(weaponDamage, 0);
    const armorVal = num(armor, 0);

    if (isBlock) {
        const blockBonusEnabled = false;
        const blockBonusMinArmor = 2;
        const blockBonusValue = 1;
        const blockBonus =
            blockBonusEnabled && armorVal >= blockBonusMinArmor ? blockBonusValue : 0;
        const effBlock = Math.max(0, def + blockBonus);

        // Рассчитываем урон по новой формуле
        const attackAfterArmor = Math.max(0, atk - armorVal); // Успехи атаки после брони
        const totalPotential = base + attackAfterArmor; // Весь потенциальный урон
        const breakthrough = Math.max(0, atk - effBlock); // Пролом = успехи атаки - успехи блока

        const rawDmg = Math.max(0, totalPotential - effBlock) + breakthrough;
        const dmg = Math.min(rawDmg, totalPotential);

        const crit = isCritical(atk, def);
        const finalDmg = crit ? dmg * 2 : dmg;
        const blockLabel = blockBonus ? `${def}+${blockBonus}` : `${def}`;
        const formula = `min(max(0, (${base} + max(0, ${atk} - ${armorVal})) - ${blockLabel}) + max(0, ${atk} - ${blockLabel}), ${base} + max(0, ${atk} - ${armorVal}))`;
        const compact = crit
            ? `(${formula}) × 2 [КРИТ] = ${finalDmg}`
            : `${formula} = ${dmg}`;
        return { damage: finalDmg, compact, hit: true, crit };
    }

    const hit = atk > def;
    if (!hit) {
        return {
            damage: 0,
            compact: `промах: ${atk} <= ${def} -> 0`,
            hit: false,
            crit: false,
        };
    }

    const effAtk = Math.max(0, atk - armorVal);
    const dmg = base + effAtk;
    const crit = isCritical(atk, def);
    const finalDmg = crit ? dmg * 2 : dmg;
    const formula = `${base} + max(0, ${atk} - ${armorVal})`;
    const compact = crit
        ? `(${formula}) × 2 [КРИТ] = ${finalDmg}`
        : `${formula} = ${dmg}`;
    return { damage: finalDmg, compact, hit: true, crit };
}

/**
 * @param {Object} options
 * @param {number} options.attackSuccesses
 * @param {number} options.defenseSuccesses
 * @param {number} options.weaponDamage
 */
function computeAbilityDamage({ weaponDamage, attackSuccesses, defenseSuccesses }) {
    const base = num(weaponDamage, 0);
    const atk = num(attackSuccesses, 0);
    const def = num(defenseSuccesses, 0);
    const hit = atk > def;
    const total = base + atk;
    const dmg = hit ? Math.max(0, total) : 0;
    const crit = hit ? isCritical(atk, def) : false;
    const finalDmg = crit ? dmg * 2 : dmg;
    const formula = `${base} + ${atk}`;
    const compact = hit
        ? crit
            ? `(${formula}) × 2 [КРИТ] = ${finalDmg}`
            : `${formula} = ${dmg}`
        : `промах: ${atk} <= ${def} -> 0`;
    return { damage: finalDmg, compact, hit, crit, atkS: atk, defS: def };
}

export const DamageResolver = {
    computeWeaponDamage,
    computeAbilityDamage,
    isCritical
};
