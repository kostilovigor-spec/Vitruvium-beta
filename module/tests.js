import { rollPool, computeDamageCompact } from "./combat.js";
import { rollSuccessDice } from "./rolls.js";
import {
  normalizeEffects,
  getAttributeRollModifiers,
  getAttackRollModifiers,
  getLuckModifiers,
} from "./effects.js";

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
      assertEqual(out.damage, 5, "block damage");
      assertEqual(out.hit, true, "block hit");
      assertEqual(
        out.compact,
        "max(0, 3 - 2) + max(0, 4 - 2) + max(0, 4 - 2) = 5",
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

    await run("effects.normalizeEffects.attributeAndAttackRollKeys", async () => {
      const out = normalizeEffects([
        { key: "conditionRollLuck", value: 1 },
        { key: "movementRollDice", value: 2 },
        { key: "attackRollLuck", value: -3 },
      ]);
      assertEqual(out.length, 3, "new effect keys should be normalized");
    });

    await run("effects.normalizeEffects.legacyAdvDisToSigned", async () => {
      const out = normalizeEffects([
        { key: "rollAdv", value: 2 },
        { key: "rollDis", value: 1 },
      ]);
      const one = out.find((e) => e.key === "rollLuck");
      assert(one, "rollLuck should exist");
      assertEqual(one.value, 1, "legacy should fold into signed key");
    });

    await run("effects.getLuckModifiers.signedNegativeIsDis", async () => {
      const out = getLuckModifiers(
        { dodgeLuck: -2 },
        {
          signedKey: "dodgeLuck",
          advKey: "dodgeAdv",
          disKey: "dodgeDis",
        }
      );
      assertEqual(out.adv, 0, "signed negative adv");
      assertEqual(out.dis, 2, "signed negative dis");
    });

    await run("effects.getAttributeRollModifiers", async () => {
      const totals = {
        combatRollLuck: 2,
        combatRollDice: 3,
      };
      const out = getAttributeRollModifiers(totals, "combat");
      assertEqual(out.adv, 2, "attr adv");
      assertEqual(out.dis, 0, "attr dis");
      assertEqual(out.dice, 3, "attr dice");
    });

    await run("effects.getAttackRollModifiers", async () => {
      const totals = {
        combatRollLuck: -1,
        combatRollDice: 3,
        attackRollLuck: 4,
        attackRollDice: 6,
      };
      const out = getAttackRollModifiers(totals, { attrKey: "combat" });
      assertEqual(out.adv, 4, "attack adv");
      assertEqual(out.dis, 1, "attack dis");
      assertEqual(out.dice, 9, "attack dice");
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
