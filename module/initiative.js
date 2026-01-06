// systems/Vitruvium/module/initiative.js

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
  // если у тебя уже есть иконки успехов — замени здесь на свои
  return Array.from({ length: Math.max(0, n) }, () => "✦").join(" ");
}

async function rollPool(pool) {
  const r = await new Roll(`${pool}dV`).evaluate();
  // Для Dice So Nice важно показать реальный Roll
  if (game.dice3d) {
    await game.dice3d.showForRoll(r, game.user, true);
  }
  return r;
}

async function luckRollShow(actorName, targetName) {
  const r = await rollPool(1);
  const s = countSuccesses(r); // 0,1,2
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

export async function vitruviumRollInitiative(combat, ids, mode = "normal") {
  const updates = [];
  const chatLines = [];

  for (const id of ids) {
    const c = combat.combatants.get(id);
    const a = c?.actor;
    if (!c || !a) continue;

    const move = clamp(num(a.system?.attributes?.movement, 1), 1, 6);

    // Advantage/Disadvantage: 2 броска, берём лучший/худший
    let r1 = await rollPool(move);
    let s1 = countSuccesses(r1);

    let chosen = { roll: r1, succ: s1, other: null };

    if (mode === "adv" || mode === "dis") {
      const r2 = await rollPool(move);
      const s2 = countSuccesses(r2);

      if (mode === "adv") {
        chosen =
          s2 > s1
            ? { roll: r2, succ: s2, other: { roll: r1, succ: s1 } }
            : { roll: r1, succ: s1, other: { roll: r2, succ: s2 } };
      } else {
        chosen =
          s2 < s1
            ? { roll: r2, succ: s2, other: { roll: r1, succ: s1 } }
            : { roll: r1, succ: s1, other: { roll: r2, succ: s2 } };
      }
    }

    // initiative = число успехов (пока без тай-брейка)
    updates.push({ _id: id, initiative: chosen.succ });

    const modeTag = mode === "adv" ? " (adv)" : mode === "dis" ? " (dis)" : "";
    chatLines.push(
      `<div><b>${c.name}</b>: Движение ${move}${modeTag} → успехи: <b>${
        chosen.succ
      }</b> ${successesIcons(chosen.succ)}</div>`
    );
  }

  // обновляем инициативу разом
  if (updates.length)
    await combat.updateEmbeddedDocuments("Combatant", updates);

  // Тай-брейк PC vs NPC при равной инициативе:
  // делаем лёгкий сдвиг ±0.01, чтобы Foundry отсортировал.
  await vitruviumResolvePcNpcTies(combat);

  // Сообщение в чат о бросках
  const head =
    mode === "adv"
      ? "Инициатива (Движение, преимущество)"
      : mode === "dis"
      ? "Инициатива (Движение, помеха)"
      : "Инициатива (Движение)";
  const content = `
    <div class="v-card v-card--attr">
      <div class="v-card__header">
        <div class="v-card__title">◈ ${head}</div>
      </div>
      <div class="v-card__row">
        <div class="v-card__label">Результаты</div>
        <div class="v-card__value">${chatLines.join("")}</div>
      </div>
      <div class="v-card__footer">
        <span class="v-rule">При равенстве PC↔NPC: бросок удачи игрока решает порядок</span>
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

    // выбор режима: normal/adv/dis
    const mode = await new Promise((resolve) => {
      new Dialog({
        title: "Vitruvium: Инициатива",
        content: `<p>Как бросать инициативу (Движение)?</p>`,
        buttons: {
          dis: {
            label: "Помеха",
            callback: () => resolve("dis"),
          },
          normal: {
            label: "Обычно",
            callback: () => resolve("normal"),
          },
          adv: {
            label: "Преимущество",
            callback: () => resolve("adv"),
          },
        },
        default: "normal",
        close: () => resolve("normal"),
      }).render(true);
    });

    await vitruviumRollInitiative(this, rollIds, mode);

    if (updateTurn) await this.update({ turn: 0 });
    return this;
  };

  // на всякий случай сохраним оригинал, если захочешь вернуть
  Combat.prototype.rollInitiative._vitruviumOriginal = original;
}
