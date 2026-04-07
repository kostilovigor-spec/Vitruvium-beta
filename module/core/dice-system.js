// module/core/dice-system.js
// ============================================================
// ЕДИНСТВЕННЫЙ источник истины для бросков dV Vitruvium.
// Все остальные модули должны использовать DiceSystem вместо
// собственных копий rollPool / countSuccesses / etc.
// ============================================================

/** Vitruvium dV: 1-3 = 0, 4-5 = 1, 6 = 2 */
export function countSuccesses(face) {
    const v = Number(face);
    if (!Number.isFinite(v)) return 0;
    if (v >= 6) return 2;
    if (v >= 4) return 1;
    return 0;
}

/** Классификация грани: "blank" | "single" | "double" */
export function classifyFace(face) {
    const v = Number(face);
    if (!Number.isFinite(v) || v <= 3) return "blank";
    if (v <= 5) return "single";
    return "double";
}

/**
 * Бросает один dV.
 * @param {Function|null} roller  Опциональная кастомная функция-бросальщик.
 *   roller() должна вернуть { roll, result } или просто result (число).
 * @returns {{ roll: Roll|null, result: number }}
 */
export async function rollSingle(roller = null) {
    if (typeof roller === "function") {
        const custom = await roller();
        const result = Number(custom?.result ?? custom);
        return {
            roll: custom?.roll ?? null,
            result: Number.isFinite(result) ? result : 1,
        };
    }

    const roll = await new Roll("1dV").evaluate();
    const result = roll.dice?.[0]?.results?.[0]?.result ?? 1;
    return { roll, result: Number(result) };
}

/** Индекс минимального (preferHighest=false) или максимального (true) элемента */
export function pickIndex(results, preferHighest) {
    let idx = 0;
    for (let i = 1; i < results.length; i++) {
        if (preferHighest) {
            if (results[i] > results[idx]) idx = i;
        } else if (results[i] < results[idx]) {
            idx = i;
        }
    }
    return idx;
}

// ─── helpers ────────────────────────────────────────────────

function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
}

function num(v, d) {
    const x = Number(v);
    return Number.isNaN(x) ? d : x;
}

// ─── rollPool ────────────────────────────────────────────────

/**
 * Бросает пул dV с поддержкой удачи / помехи / fullMode.
 *
 * @param {number} pool   Размер пула кубов (1-20).
 * @param {object} opts
 *   @param {number}   opts.luck      Счётчики преимущества (перебросы лучшего).
 *   @param {number}   opts.unluck    Счётчики помехи (перебросы худшего).
 *   @param {string}   opts.fullMode  "normal" | "adv" | "dis" (полный переброс всего пула).
 *   @param {Function} opts.roller    Кастомный бросальщик пула: (pool) => { roll, results, successes? }.
 *   @param {Function} opts.dieRoller Кастомный бросальщик одного куба: () => { roll, result }.
 *   @param {Function} opts.onRoll    Коллбэк после каждого Roll: (roll: Roll) => Promise<void>.
 *                                    Используется для dice3d / Dice So Nice.
 * @returns {Promise<{
 *   pool: number,
 *   successes: number,
 *   rolls: Roll[],
 *   results: number[],
 *   luck: number,
 *   unluck: number,
 *   fullMode: string,
 *   rerolls: Array,
 * }>}
 */
export async function rollPool(pool, opts = {}) {
    pool = clamp(num(pool, 1), 1, 20);

    const optsObj = typeof opts === "object" && opts ? opts : {};
    const roller = typeof optsObj.roller === "function" ? optsObj.roller : null;
    const dieRoller =
        typeof optsObj.dieRoller === "function" ? optsObj.dieRoller : null;
    const onRoll =
        typeof optsObj.onRoll === "function" ? optsObj.onRoll : null;
    const fullMode = String(optsObj.fullMode ?? "normal");
    let luck = clamp(Math.round(num(optsObj.luck, 0)), 0, 20);
    let unluck = clamp(Math.round(num(optsObj.unluck, 0)), 0, 20);

    /** Бросает весь пул один раз */
    const rollOnce = async () => {
        if (roller) {
            const custom = await roller(pool);
            const results = Array.isArray(custom?.results)
                ? custom.results.map((v) => Number(v))
                : [];
            const successes = Number.isFinite(custom?.successes)
                ? custom.successes
                : results.reduce((acc, v) => acc + countSuccesses(v), 0);
            return { roll: custom?.roll ?? null, results, successes };
        }

        const roll = await new Roll(`${pool}dV`).evaluate();
        if (onRoll) await onRoll(roll);
        const results = (roll.dice?.[0]?.results ?? []).map((r) =>
            Number(r.result)
        );
        const successes = results.reduce((acc, v) => acc + countSuccesses(v), 0);
        return { roll, results, successes };
    };

    // ── fullMode: полный переброс пула ──────────────────────────
    if (fullMode === "adv" || fullMode === "dis") {
        const a = await rollOnce();
        const b = await rollOnce();
        const chosen =
            fullMode === "adv"
                ? b.successes > a.successes
                    ? b
                    : a
                : b.successes < a.successes
                    ? b
                    : a;
        return {
            pool,
            successes: chosen.successes,
            rolls: [a.roll, b.roll].filter(Boolean),
            results: chosen.results,
            luck: 0,
            unluck: 0,
            fullMode,
            rerolls: [],
        };
    }

    // ── Нормализация luck / unluck ───────────────────────────────
    const diff = luck - unluck;
    if (diff > 0) {
        luck = diff;
        unluck = 0;
    } else if (diff < 0) {
        unluck = Math.abs(diff);
        luck = 0;
    }
    luck = Math.min(luck, pool);
    unluck = Math.min(unluck, pool);

    // ── Базовый бросок ───────────────────────────────────────────
    const base = await rollOnce();
    const roll = base.roll;
    const results = Array.isArray(base.results) ? base.results : [];
    const rolls = roll ? [roll] : [];
    const rerolls = [];

    /** Перебросить один куб */
    const applyReroll = async (index, preferHigher) => {
        const before = results[index];
        const rr = await rollSingle(dieRoller);
        if (rr.roll && onRoll) await onRoll(rr.roll);
        const after = rr.result;
        const chosen = preferHigher
            ? Math.max(before, after)
            : Math.min(before, after);
        results[index] = chosen;
        if (rr.roll) rolls.push(rr.roll);
        return { index, before, after, chosen };
    };

    for (let i = 0; i < luck; i++) {
        const idx = pickIndex(results, false); // перебросить наименьший
        rerolls.push({ kind: "luck", ...(await applyReroll(idx, true)) });
    }
    for (let i = 0; i < unluck; i++) {
        const idx = pickIndex(results, true); // перебросить наибольший
        rerolls.push({ kind: "unluck", ...(await applyReroll(idx, false)) });
    }

    const successes = results.reduce((acc, v) => acc + countSuccesses(v), 0);

    return {
        pool,
        successes,
        rolls,
        results,
        luck,
        unluck,
        fullMode: "normal",
        rerolls,
    };
}

// ── Публичное API ────────────────────────────────────────────

export const DiceSystem = {
    rollPool,
    rollSingle,
    countSuccesses,
    classifyFace,
    pickIndex,
};
