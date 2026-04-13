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
    const margin = atk - def;

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

        const blockLabel = blockBonus ? `${def}+${blockBonus}` : `${def}`;
        const formula = `min(max(0, (${base} + max(0, ${atk} - ${armorVal})) - ${blockLabel}) + max(0, ${atk} - ${blockLabel}), ${base} + max(0, ${atk} - ${armorVal}))`;
        const compact = `${formula} = ${dmg}`;
        return { damage: dmg, compact, hit: true, margin };
    }

    const hit = atk > def;
    if (!hit) {
        return {
            damage: 0,
            compact: `промах: ${atk} <= ${def} -> 0`,
            hit: false,
            margin,
        };
    }

    const effAtk = Math.max(0, atk - armorVal);
    const dmg = base + effAtk;
    const formula = `${base} + max(0, ${atk} - ${armorVal})`;
    const compact = `${formula} = ${dmg}`;
    return { damage: dmg, compact, hit: true, margin };
}

/**
 * @param {Object} options
 * @param {number} options.weaponDamage
 * @param {number} options.attackSuccesses
 * @param {number} options.defenseSuccesses
 */
function computeAbilityDamage({ weaponDamage, attackSuccesses, defenseSuccesses }) {
    const base = num(weaponDamage, 0);
    const atk = num(attackSuccesses, 0);
    const def = num(defenseSuccesses, 0);
    const hit = atk > def;
    const total = base + atk;
    const dmg = hit ? Math.max(0, total) : 0;
    const margin = atk - def;
    const formula = `${base} + ${atk}`;
    const compact = hit
        ? `${formula} = ${dmg}`
        : `промах: ${atk} <= ${def} -> 0`;
    return { damage: dmg, compact, hit, margin, atkS: atk, defS: def };
}

export const DamageResolver = {
    computeWeaponDamage,
    computeAbilityDamage,
};
