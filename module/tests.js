import { rollPool, computeDamageCompact } from "./combat.js";
import { rollSuccessDice } from "./rolls.js";

const dvSuccesses = (face) => {
  const v = Number(face);
  if (!Number.isFinite(v)) return 0;
  if (v <= 3) return 0;
  if (v <= 5) return 1;
  return 2;
};

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const assertEqual = (actual, expected, msg) => {
  if (actual !== expected) {
    throw new Error(`${msg} (expected ${expected}, got ${actual})`);
  }
};

const assertArrayEqual = (actual, expected, msg) => {
  const a = Array.isArray(actual) ? actual : [];
  const e = Array.isArray(expected) ? expected : [];
  if (a.length !== e.length) {
    throw new Error(`${msg} (length ${a.length} !== ${e.length})`);
  }
  for (let i = 0; i < e.length; i++) {
    if (a[i] !== e[i]) {
      throw new Error(`${msg} (index ${i}: ${a[i]} !== ${e[i]})`);
    }
  }
};

const makeRoller = (sequence) => async (pool) => {
  if (!sequence.length) throw new Error("No more test rolls");
  const results = sequence.shift();
  if (!Array.isArray(results) || results.length !== pool) {
    throw new Error(`Pool mismatch: expected ${pool} results`);
  }
  const successes = results.reduce((acc, r) => acc + dvSuccesses(r), 0);
  return { roll: null, results, successes };
};

const makeDieRoller = (sequence) => async () => {
  if (!sequence.length) throw new Error("No more test die rolls");
  const result = sequence.shift();
  return { roll: null, result };
};

export const registerVitruviumTests = () => {
  game.vitruvium = game.vitruvium ?? {};
  game.vitruvium.runTests = async () => {
    const results = [];
    const run = async (name, fn) => {
      try {
        await fn();
        results.push({ name, ok: true });
      } catch (err) {
        results.push({ name, ok: false, err });
      }
    };

    await run("combat.computeDamageCompact.block", async () => {
      const out = computeDamageCompact({
        weaponDamage: 3,
        atkS: 4,
        defS: 2,
        defenseType: "block",
        armorFull: 2,
        armorNoShield: 1,
      });
      assertEqual(out.damage, 3, "block damage");
      assertEqual(out.hit, true, "block hit");
      assertEqual(
        out.compact,
        "max(0, 3 - 2) + max(0, 4 - 2) = 3",
        "block compact"
      );
    });

    await run("combat.computeDamageCompact.dodgeHit", async () => {
      const out = computeDamageCompact({
        weaponDamage: 2,
        atkS: 3,
        defS: 1,
        defenseType: "dodge",
        armorFull: 0,
        armorNoShield: 2,
      });
      assertEqual(out.damage, 3, "dodge hit damage");
      assertEqual(out.hit, true, "dodge hit");
      assertEqual(out.compact, "2 + max(0, 3 - 2) = 3", "dodge hit compact");
    });

    await run("combat.computeDamageCompact.dodgeMiss", async () => {
      const out = computeDamageCompact({
        weaponDamage: 2,
        atkS: 1,
        defS: 2,
        defenseType: "dodge",
        armorFull: 0,
        armorNoShield: 3,
      });
      assertEqual(out.damage, 0, "dodge miss damage");
      assertEqual(out.hit, false, "dodge miss");
      assertEqual(out.compact, "промах: 1 <= 2 -> 0", "dodge miss compact");
    });

    await run("combat.rollPool.luckReroll", async () => {
      const roller = makeRoller([[1, 4, 6]]);
      const dieRoller = makeDieRoller([6]);
      const out = await rollPool(3, {
        luck: 1,
        unluck: 0,
        roller,
        dieRoller,
      });
      assertArrayEqual(out.results, [6, 4, 6], "rollPool luck results");
      assertEqual(out.successes, 5, "rollPool luck successes");
      assertEqual(out.rerolls.length, 1, "rollPool luck rerolls");
      assertEqual(out.rerolls[0].index, 0, "rollPool luck reroll index");
      assertEqual(out.rerolls[0].chosen, 6, "rollPool luck chosen");
    });

    await run("combat.rollPool.unluckReroll", async () => {
      const roller = makeRoller([[6, 5, 2]]);
      const dieRoller = makeDieRoller([1]);
      const out = await rollPool(3, {
        luck: 0,
        unluck: 1,
        roller,
        dieRoller,
      });
      assertArrayEqual(out.results, [1, 5, 2], "rollPool unluck results");
      assertEqual(out.successes, 1, "rollPool unluck successes");
    });

    await run("combat.rollPool.fullModeAdv", async () => {
      const roller = makeRoller([
        [1, 1],
        [6, 6],
      ]);
      const out = await rollPool(2, {
        fullMode: "adv",
        roller,
      });
      assertArrayEqual(out.results, [6, 6], "rollPool adv results");
      assertEqual(out.successes, 4, "rollPool adv successes");
      assertEqual(out.fullMode, "adv", "rollPool adv fullMode");
      assertEqual(out.luck, 0, "rollPool adv luck");
      assertEqual(out.unluck, 0, "rollPool adv unluck");
    });

    await run("combat.rollPool.luckClampedToPool", async () => {
      const roller = makeRoller([[1, 1]]);
      const dieRoller = makeDieRoller([6, 6]);
      const out = await rollPool(2, {
        luck: 5,
        unluck: 0,
        roller,
        dieRoller,
      });
      assertArrayEqual(out.results, [6, 6], "rollPool clamp results");
      assertEqual(out.rerolls.length, 2, "rollPool clamp rerolls");
    });

    await run("rolls.rollSuccessDice.fullModeAdv", async () => {
      const roller = makeRoller([
        [1, 1],
        [6, 6],
      ]);
      const out = await rollSuccessDice({
        pool: 2,
        fullMode: "adv",
        roller,
        silent: true,
      });
      assertArrayEqual(out.results, [6, 6], "rollSuccessDice adv results");
      assertEqual(out.successes, 4, "rollSuccessDice adv successes");
      assertEqual(out.fullMode, "adv", "rollSuccessDice adv fullMode");
    });

    await run("rolls.rollSuccessDice.luckReroll", async () => {
      const roller = makeRoller([[1, 4, 6]]);
      const dieRoller = makeDieRoller([6]);
      const out = await rollSuccessDice({
        pool: 3,
        luck: 1,
        unluck: 0,
        fullMode: "normal",
        roller,
        dieRoller,
        silent: true,
      });
      assertArrayEqual(out.results, [6, 4, 6], "rollSuccessDice luck results");
      assertEqual(out.successes, 5, "rollSuccessDice luck successes");
      assertEqual(out.rerolls.length, 1, "rollSuccessDice luck rerolls");
    });

    const passed = results.filter((r) => r.ok).length;
    const failed = results.length - passed;
    const title = `[Vitruvium Tests] ${passed}/${results.length} passed`;

    if (failed > 0) {
      console.error(title);
      for (const r of results) {
        if (!r.ok) {
          console.error(`- ${r.name}:`, r.err);
        }
      }
      ui.notifications?.error(title);
    } else {
      console.log(title);
      ui.notifications?.info(title);
    }

    return { passed, failed, results };
  };
};
