import { rollPool } from "./combat.js";
import { DamageResolver } from "./core/damage-resolver.js";
import { rollSuccessDice } from "./rolls.js";
import {
  normalizeModifiers,
  collectEffectTotals,
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

    await run("core.damageResolver.weaponDamage.block", async () => {
      const out = DamageResolver.computeWeaponDamage({
        weaponDamage: 3,
        attackSuccesses: 4,
        defenseSuccesses: 2,
        isBlock: true,
        armor: 2,
      });
      assertEqual(out.damage, 5, "block damage");
      assertEqual(out.hit, true, "block hit");
      assertEqual(
        out.compact,
        "min(max(0, (3 + max(0, 4 - 2)) - 2) + max(0, 4 - 2), 3 + max(0, 4 - 2)) = 5",
        "block compact"
      );
    });

    await run("core.damageResolver.weaponDamage.dodgeHit", async () => {
      const out = DamageResolver.computeWeaponDamage({
        weaponDamage: 2,
        attackSuccesses: 3,
        defenseSuccesses: 1,
        isBlock: false,
        armor: 2,
      });
      assertEqual(out.damage, 3, "dodge hit damage");
      assertEqual(out.hit, true, "dodge hit");
      assertEqual(out.compact, "2 + max(0, 3 - 2) = 3", "dodge hit compact");
    });

    await run("core.damageResolver.weaponDamage.dodgeMiss", async () => {
      const out = DamageResolver.computeWeaponDamage({
        weaponDamage: 2,
        attackSuccesses: 1,
        defenseSuccesses: 2,
        isBlock: false,
        armor: 3,
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

    await run("effects.normalizeModifiers.attributeAndAttackRollKeys", async () => {
      const out = normalizeModifiers([
        { key: "conditionAdv", value: 1 },
        { key: "movementDice", value: 2 },
        { key: "attackDis", value: 3 },
      ]);
      assertEqual(out.length, 3, "new effect keys should be normalized");
    });

    await run("effects.normalizeModifiers.legacyEffectKeyField", async () => {
      const out = normalizeModifiers([{ effectKey: "speed", value: 2 }]);
      const one = out.find((e) => e.key === "speed");
      assert(one, "speed should exist from effectKey");
      assertEqual(one.value, 2, "effectKey value should be used");
    });

    await run("effects.getLuckModifiers", async () => {
      const out = getLuckModifiers(
        { dodgeAdv: 2, dodgeDis: 1, dodgeLucky: 1, dodgeUnlucky: 0 },
        {
          advKey: "dodgeAdv",
          disKey: "dodgeDis",
          luckyKey: "dodgeLucky",
          unluckyKey: "dodgeUnlucky",
        }
      );
      assertEqual(out.adv, 2, "adv");
      assertEqual(out.dis, 1, "dis");
      assertEqual(out.lucky, 1, "lucky");
      assertEqual(out.unlucky, 0, "unlucky");
    });

    await run("effects.getAttributeRollModifiers", async () => {
      const totals = {
        combatAdv: 2,
        combatDis: 0,
        combatLucky: 1,
        combatUnlucky: 0,
        combatDice: 3,
      };
      const out = getAttributeRollModifiers(totals, "combat");
      assertEqual(out.adv, 2, "attr adv");
      assertEqual(out.dis, 0, "attr dis");
      assertEqual(out.lucky, 1, "attr lucky");
      assertEqual(out.unlucky, 0, "attr unlucky");
      assertEqual(out.dice, 3, "attr dice");
    });

    await run("effects.getAttackRollModifiers", async () => {
      const totals = {
        combatAdv: 0,
        combatDis: 1,
        combatLucky: 0,
        combatUnlucky: 1,
        combatDice: 3,
        attackAdv: 4,
        attackDis: 0,
        attackLucky: 1,
        attackUnlucky: 0,
        attackDice: 6,
      };
      const out = getAttackRollModifiers(totals, { attrKey: "combat" });
      assertEqual(out.adv, 4, "attack adv");
      assertEqual(out.dis, 1, "attack dis");
      assertEqual(out.lucky, 1, "attack lucky");
      assertEqual(out.unlucky, 1, "attack unlucky");
      assertEqual(out.dice, 9, "attack dice");
    });

    await run("effects.collectEffectTotals.stateActiveFilter", async () => {
      const actor = {
        items: [
          {
            type: "state",
            system: { active: true, effects: [{ key: "speed", value: 1 }] },
          },
          {
            type: "state",
            system: { active: false, effects: [{ key: "speed", value: 5 }] },
          },
          {
            type: "state",
            system: { effects: [{ key: "speed", value: 2 }] },
          },
        ],
      };
      const totals = collectEffectTotals(actor);
      assertEqual(totals.speed, 3, "inactive states should not contribute");
    });

    await run("effects.collectEffectTotals.skillAlwaysActive", async () => {
      const actor = {
        items: [
          {
            type: "skill",
            system: {
              active: false,
              effects: [{ key: "combatRollDice", value: 1 }],
            },
          },
        ],
      };
      const totals = collectEffectTotals(actor);
      assertEqual(totals.combatRollDice, 1, "skill effects should always apply");
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
      ui.notifications?.info(title);
    }

    return { passed, failed, results };
  };
};
