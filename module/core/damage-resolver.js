function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
}

/**
 * Проверяет, является ли тип урона физическим
 * @param {string} damageType - тип урона
 * @returns {boolean}
 */
function isPhysicalDamage(damageType) {
    const physicalTypes = ['physical', 'piercing', 'slashing', 'bludgeoning'];
    return physicalTypes.includes(String(damageType ?? '').trim().toLowerCase());
}

/**
 * @param {Object} options
 * @param {number} options.attackSuccesses
 * @param {number} options.defenseSuccesses
 * @param {number} options.weaponDamage
 * @param {number} options.armor
 * @param {boolean} options.isBlock
 * @param {string} options.damageType - тип урона
 */
function computeWeaponDamage({
    attackSuccesses,
    defenseSuccesses,
    weaponDamage,
    armor,
    isBlock,
    damageType
}) {
    const atk = num(attackSuccesses, 0);
    const def = num(defenseSuccesses, 0);
    const base = num(weaponDamage, 0);
    const armorVal = isPhysicalDamage(damageType) ? num(armor, 0) : 0;
    const margin = atk - def;

    if (isBlock) {
        const blockBonusEnabled = false;
        const blockBonusMinArmor = 2;
        const blockBonusValue = 1;
        const blockBonus =
            blockBonusEnabled && armorVal >= blockBonusMinArmor ? blockBonusValue : 0;
        const effBlock = Math.max(0, def + blockBonus);

        // Броня вычитается из урона оружия, а не из успехов атаки
        const baseDamageAfterArmor = Math.max(0, base - armorVal);
        const totalPotential = baseDamageAfterArmor + atk;
        const breakthrough = Math.max(0, atk - effBlock);

        const rawDmg = Math.max(0, totalPotential - effBlock) + breakthrough;
        const dmg = Math.min(rawDmg, totalPotential);

        const blockLabel = blockBonus ? `${def}+${blockBonus}` : `${def}`;
        const armorLabel = armorVal > 0 ? ` - ${armorVal}` : '';
        const formula = `min(max(0, (max(0, ${base}${armorLabel}) + ${atk}) - ${blockLabel}) + max(0, ${atk} - ${blockLabel}), max(0, ${base}${armorLabel}) + ${atk})`;
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

    // Броня вычитается из урона оружия
    const baseDamageAfterArmor = Math.max(0, base - armorVal);
    const dmg = baseDamageAfterArmor + atk;
    const armorLabel = armorVal > 0 ? ` - ${armorVal}` : '';
    const formula = `max(0, ${base}${armorLabel}) + ${atk}`;
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
