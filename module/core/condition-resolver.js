/**
 * ConditionResolver — универсальная система проверки условий на основе разницы успехов (margin).
 *
 * Заменяет механику crit.
 * Вместо жёсткой проверки "крит" используется гибкое правило:
 *   "эффект срабатывает, если margin >= threshold"
 */

/**
 * Проверить условие против контекста броска.
 *
 * @param {Object|null} condition — условие из эффекта/состояния
 * @param {Object} context — контекст броска
 * @param {number} context.atk — успехи атакующего
 * @param {number} context.def — успехи защитника
 * @param {number} context.margin — разница успехов (atk - def)
 * @returns {boolean}
 */
function checkCondition(condition, context) {
    if (!condition || !condition.type) return false;

    const atk = Number(context?.atk ?? 0);
    const def = Number(context?.def ?? 0);
    const margin = Number(context?.margin ?? atk - def);

    switch (condition.type) {
        case "margin": {
            const threshold = Number(condition.value ?? 0);
            return margin >= threshold;
        }

        default:
            console.warn(`ConditionResolver: неизвестный тип условия "${condition.type}"`);
            return false;
    }
}

/**
 * Миграция старого applyMode "CRIT_ATTACK" в новую систему условий.
 *
 * @param {string|null} applyMode
 * @returns {Object|null} condition или null
 */
function migrateApplyModeToCondition(applyMode) {
    if (applyMode === "CRIT_ATTACK") {
        return { type: "margin", value: 2 };
    }
    return null;
}

/**
 * Список допустимых режимов применения состояний.
 */
const APPLY_MODES = ["self", "targetNoCheck", "targetContest", "margin"];

function isValidApplyMode(mode) {
    return APPLY_MODES.includes(mode);
}

/**
 * Нормализовать режим применения.
 * Если mode === "CRIT_ATTACK" — мигрирует в "margin" + возвращает condition.
 *
 * @param {string} mode
 * @returns {{ mode: string, condition: Object|null }}
 */
function normalizeApplyMode(mode) {
    if (mode === "CRIT_ATTACK") {
        return { mode: "margin", condition: { type: "margin", value: 2 } };
    }
    if (isValidApplyMode(mode)) {
        return { mode, condition: mode === "margin" ? { type: "margin", value: 2 } : null };
    }
    return { mode: "targetContest", condition: null };
}

export const ConditionResolver = {
    checkCondition,
    migrateApplyModeToCondition,
    APPLY_MODES,
    isValidApplyMode,
    normalizeApplyMode,
};
