// systems/Vitruvium/module/initiative.js
import { collectEffectTotals, getEffectValue } from "./effects.js";

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}
function num(v, d) {
  const x = Number(v);
  return Number.isNaN(x) ? d : x;
}

// успехи: 4-5 = 1, 6 = 2
function countSuccesses(roll) {
  // roll.dice[0].results -> [{result:1..6}, ...]
  const die = roll.dice?.[0];
  const results = die?.results ?? [];
  let s = 0;
  for (const r of results) {
    const v = r.result;
    if (v === 6) s += 2;
    else if (v === 4 || v === 5) s += 1;
  }
  return s;
}

function successesIcons(n) {
  // если у тебя уже есть иконки успехов - замени здесь на свои
  return Array.from({ length: Math.max(0, n) }, () => "?").join(" ");
}

async function rollDieOnce() {
  const r = await new Roll("1dV").evaluate();
  if (game.dice3d) {
    await game.dice3d.showForRoll(r, game.user, true);
  }
  const result = r.dice?.[0]?.results?.[0]?.result ?? 1;
  return { roll: r, result: Number(result) };
}

function pickIndex(results, preferHighest) {
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

function modeLabel(luck = 0, unluck = 0) {
  const l = Number(luck) || 0;
  const u = Number(unluck) || 0;
  if (l <= 0 && u <= 0) return "Обычный";
  const adv = l === 1 ? "С преимуществом" : `С ${l} преимуществами`;
  const dis = u === 1 ? "С помехой" : `С ${u} помехами`;
  if (l > 0 && u <= 0) return adv;
  if (u > 0 && l <= 0) return dis;
  return `${adv} / ${dis}`;
}

function fullModeLabel(mode) {
  const m = String(mode ?? "normal");
  if (m === "adv") return "Удачливый (полный переброс)";
  if (m === "dis") return "Неудачливый (полный переброс)";
  return "Обычный";
}

async function rollPool(pool, { luck = 0, unluck = 0, fullMode = "normal" } = {}) {
  pool = clamp(num(pool, 1), 1, 20);
  const full = String(fullMode ?? "normal");

  const rollOnce = async () => {
    const roll = await new Roll(`${pool}dV`).evaluate();
    if (game.dice3d) {
      await game.dice3d.showForRoll(roll, game.user, true);
    }
    const results = (roll.dice?.[0]?.results ?? []).map((r) =>
      Number(r.result)
    );
    const successRoll = {
      dice: [{ results: results.map((result) => ({ result })) }],
    };
    const successes = countSuccesses(successRoll);
    return { roll, results, successes };
  };

  if (full === "adv" || full === "dis") {
    const a = await rollOnce();
    const b = await rollOnce();
    const chosen =
      full === "adv"
        ? b.successes > a.successes
          ? b
          : a
        : b.successes < a.successes
        ? b
        : a;
    return {
      roll: chosen.roll,
      rolls: [a.roll, b.roll],
      results: chosen.results,
      successes: chosen.successes,
      luck: 0,
      unluck: 0,
      fullMode: full,
    };
  }

  const roll = await new Roll(`${pool}dV`).evaluate();
  if (game.dice3d) {
    await game.dice3d.showForRoll(roll, game.user, true);
  }

  const results = (roll.dice?.[0]?.results ?? []).map((r) =>
    Number(r.result)
  );
  const rolls = [roll];

  const applyReroll = async (index, preferHigher) => {
    const before = results[index];
    const rr = await rollDieOnce();
    const after = rr.result;
    results[index] = preferHigher ? Math.max(before, after) : Math.min(before, after);
    rolls.push(rr.roll);
  };

  let luckCount = clamp(Math.round(num(luck, 0)), 0, 20);
  let unluckCount = clamp(Math.round(num(unluck, 0)), 0, 20);
  const diff = luckCount - unluckCount;
  if (diff > 0) {
    luckCount = diff;
    unluckCount = 0;
  } else if (diff < 0) {
    unluckCount = Math.abs(diff);
    luckCount = 0;
  }
  luckCount = Math.min(luckCount, pool);
  unluckCount = Math.min(unluckCount, pool);

  for (let i = 0; i < luckCount; i++) {
    const idx = pickIndex(results, false);
    await applyReroll(idx, true);
  }
  for (let i = 0; i < unluckCount; i++) {
    const idx = pickIndex(results, true);
    await applyReroll(idx, false);
  }

  const successRoll = {
    dice: [{ results: results.map((result) => ({ result })) }],
  };
  const successes = countSuccesses(successRoll);
  return {
    roll,
    rolls,
    results,
    successes,
    luck: luckCount,
    unluck: unluckCount,
    fullMode: "normal",
  };
}

async function luckRollShow(actorName, targetName) {
  const r = await rollPool(1);
  const s = r.successes; // 0,1,2
  const ok = s > 0;
  const content = `
    <div class="v-card v-card--luck">
      <div class="v-card__header">
        <div class="v-card__title">☾ ${actorName} — Бросок удачи (тай-брейк против ${targetName})</div>
      </div>
      <div class="v-card__row">
        <div class="v-card__label">Результат</div>
        <div class="v-card__value"><b>${ok ? "Успех" : "Провал"}</b></div>
      </div>
    </div>
  `;
  await ChatMessage.create({ content });
  return ok;
}

function isPC(combatant) {
  const a = combatant.actor;
  if (!a) return false;
  // PC = есть владелец-игрок или тип character
  return a.hasPlayerOwner || a.type === "character";
}

export async function vitruviumRollInitiative(combat, ids, rollOpts = {}) {
  const updates = [];
  const chatLines = [];

  const luck = clamp(num(rollOpts.luck, 0), 0, 20);
  const unluck = clamp(num(rollOpts.unluck, 0), 0, 20);
  const fullMode = String(rollOpts.fullMode ?? "normal");
  const fullText = fullModeLabel(fullMode);
  const modeText =
    fullMode === "adv" || fullMode === "dis"
      ? fullText
      : modeLabel(luck, unluck);
  const modeTag = modeText === "Обычный" ? "" : ` (${modeText})`;

  for (const id of ids) {
    const c = combat.combatants.get(id);
    const a = c?.actor;
    if (!c || !a) continue;

    const move = clamp(num(a.system?.attributes?.movement, 1), 1, 6);
    const effectTotals = collectEffectTotals(a);
    const attrAdv = Math.max(0, getEffectValue(effectTotals, "adv_movement"));
    const attrDis = Math.max(0, getEffectValue(effectTotals, "dis_movement"));
    const totalLuck = luck + attrAdv;
    const totalUnluck = unluck + attrDis;
    let appliedLuck = totalLuck;
    let appliedUnluck = totalUnluck;
    const diff = appliedLuck - appliedUnluck;
    if (diff > 0) {
      appliedLuck = diff;
      appliedUnluck = 0;
    } else if (diff < 0) {
      appliedUnluck = Math.abs(diff);
      appliedLuck = 0;
    }
    appliedLuck = Math.min(appliedLuck, move);
    appliedUnluck = Math.min(appliedUnluck, move);
    const lineModeText =
      fullMode === "adv" || fullMode === "dis"
        ? fullText
        : modeLabel(appliedLuck, appliedUnluck);
    const lineModeTag = lineModeText === "Обычный" ? "" : ` (${lineModeText})`;

    const r1 = await rollPool(move, {
      luck: totalLuck,
      unluck: totalUnluck,
      fullMode,
    });
    const s1 = r1.successes;

    // initiative = число успехов (пока без тай-брейка)
    updates.push({ _id: id, initiative: s1 });

    chatLines.push(
      `<div><b>${c.name}</b>: Движение ${move}${lineModeTag} - успехи: <b>${s1}</b> ${successesIcons(s1)}</div>`
    );
  }

  // обновляем инициативу разом
  if (updates.length)
    await combat.updateEmbeddedDocuments("Combatant", updates);

  // Тай-брейк PC vs NPC при равной инициативе:
  // делаем лёгкий сдвиг +0.01, чтобы Foundry отсортировал.
  await vitruviumResolvePcNpcTies(combat);

  // Сообщение в чат о бросках
  const head =
    modeText === "Обычный"
      ? "Инициатива (Движение)"
      : `Инициатива (Движение, ${modeText})`;
  const content = `
    <div class="v-card v-card--attr">
      <div class="v-card__header">
        <div class="v-card__title">? ${head}</div>
      </div>
      <div class="v-card__row">
        <div class="v-card__label">Результаты</div>
        <div class="v-card__value">${chatLines.join("")}</div>
      </div>
      <div class="v-card__footer">
        <span class="v-rule">При равенстве PC-NPC: бросок удачи игрока решает порядок</span>
      </div>
    </div>
  `;
  await ChatMessage.create({ content });
}

async function vitruviumResolvePcNpcTies(combat) {
  // группируем по базовой инициативе (целой части)
  const groups = new Map(); // key: integer initiative, val: combatants[]
  for (const c of combat.combatants) {
    if (c.initiative === null || c.initiative === undefined) continue;
    const base = Math.trunc(Number(c.initiative));
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(c);
  }

  const tieUpdates = [];

  for (const [base, list] of groups.entries()) {
    if (list.length < 2) continue;

    const pcs = list.filter(isPC);
    const npcs = list.filter((c) => !isPC(c));

    // интересует только смешанная группа
    if (!pcs.length || !npcs.length) continue;

    // Мы делаем простой вариант: каждый PC делает 1 бросок удачи против "группы NPC" этого тай-брейка.
    // успех → PC слегка выше (base + 0.01), провал → слегка ниже (base - 0.01).
    for (const pc of pcs) {
      const ok = await luckRollShow(pc.name, "NPC");
      const newInit = base + (ok ? 0.01 : -0.01);
      tieUpdates.push({ _id: pc.id, initiative: newInit });
    }
    // NPC оставляем на base; NPC↔NPC и PC↔PC равенства решаются ручной перестановкой, как ты описал.
  }

  if (tieUpdates.length)
    await combat.updateEmbeddedDocuments("Combatant", tieUpdates);
}

export function patchVitruviumInitiative() {
  // подменяем стандартную rollInitiative
  const original = Combat.prototype.rollInitiative;

  Combat.prototype.rollInitiative = async function (
    ids,
    { updateTurn = true } = {}
  ) {
    // ids может быть undefined => роллим всех
    const rollIds = ids?.length ? ids : this.combatants.map((c) => c.id);

    const choice = await new Promise((resolve) => {
      new Dialog({
        title: "Vitruvium: Инициатива",
        content: `<div style="display:grid; gap:8px;">
          <div>Как бросать инициативу (Движение)?</div>
          <label>Удачливый бросок
            <select name="fullMode" style="width:100%">
              <option value="normal">Обычный</option>
              <option value="adv">Удачливый (полный переброс)</option>
              <option value="dis">Неудачливый (полный переброс)</option>
            </select>
          </label>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <label>Преимущество
              <input type="number" name="luck" value="0" min="0" max="20" step="1" style="width:100%"/>
            </label>
            <label>Помеха
              <input type="number" name="unluck" value="0" min="0" max="20" step="1" style="width:100%"/>
            </label>
          </div>
          <div style="font-size:12px; opacity:.75;">Каждый счетчик преимущества/помехи перебрасывает один куб. Удачливый/неудачливый бросок игнорирует счетчики.</div>
        </div>`,
        buttons: {
          roll: {
            label: "Бросить",
            callback: (html) =>
              resolve({
                luck: clamp(num(html.find("input[name='luck']").val(), 0), 0, 20),
                unluck: clamp(
                  num(html.find("input[name='unluck']").val(), 0),
                  0,
                  20
                ),
                fullMode: html.find("select[name='fullMode']").val(),
              }),
          },
          cancel: {
            label: "Отмена",
            callback: () => resolve(null),
          },
        },
        default: "roll",
        close: () => resolve(null),
      }).render(true);
    });

    if (!choice) return this;
    await vitruviumRollInitiative(this, rollIds, choice);

    if (updateTurn) await this.update({ turn: 0 });
    return this;
  };

  // на всякий случай сохраним оригинал, если захочешь вернуть
  Combat.prototype.rollInitiative._vitruviumOriginal = original;
}



