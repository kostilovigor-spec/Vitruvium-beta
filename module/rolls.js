/** Vitruvium dV: 1-3 = 0, 4-5 = 1, 6 = 2 */
function dvSuccesses(face) {
  const v = Number(face);
  if (!Number.isFinite(v)) return 0;
  if (v >= 6) return 2;
  if (v >= 4) return 1;
  return 0;
}

function dvFaceKind(face) {
  const v = Number(face);
  if (!Number.isFinite(v) || v <= 3) return "blank";
  if (v <= 5) return "single";
  return "double";
}

function renderFaces(results = []) {
  return `
    <div class="v-faces v-compact-faces">
      ${results
        .map((r) => {
          const kind = dvFaceKind(r);
          const icon =
            kind === "double" ? "●●" : kind === "single" ? "●" : "○";
          return `<span class="v-face v-face--${kind}" title="${r}">${icon}</span>`;
        })
        .join("")}
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

async function rollDieOnce(roller) {
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

function formatAdvantage(count) {
  return count === 1 ? "С преимуществом" : `С ${count} преимуществами`;
}

function formatDisadvantage(count) {
  return count === 1 ? "С помехой" : `С ${count} помехами`;
}

export async function rollSuccessDice({
  pool = 1,
  actorName = "Актор",
  checkName = "Проверка",
  mode = "normal", // legacy: "normal" | "adv" | "dis"
  luck = 0,
  unluck = 0,
  fullMode = "normal", // "normal" | "adv" | "dis" (full reroll)
  roller = null,
  dieRoller = null,
  silent = false,
} = {}) {
  pool = Number(pool);
  if (Number.isNaN(pool)) pool = 1;
  pool = clamp(pool, 1, 20);

  const full = String(fullMode ?? "normal");
  const useRoller = typeof roller === "function" ? roller : null;
  const useDieRoller = typeof dieRoller === "function" ? dieRoller : null;

  const rollOnce = async () => {
    if (useRoller) {
      const custom = await useRoller(pool);
      const results = Array.isArray(custom?.results)
        ? custom.results.map((r) => Number(r))
        : [];
      const successes = Number.isFinite(custom?.successes)
        ? custom.successes
        : results.reduce((acc, r) => acc + dvSuccesses(r), 0);
      return {
        roll: custom?.roll ?? null,
        results,
        successes,
      };
    }

    const roll = await new Roll(`${pool}dV`).evaluate();
    const results = (roll.dice?.[0]?.results ?? []).map((r) =>
      Number(r.result)
    );
    const successes = results.reduce((acc, r) => acc + dvSuccesses(r), 0);
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

    const modeLabel =
      full === "adv"
        ? "Удачливый (полный переброс)"
        : "Неудачливый (полный переброс)";
    const modeClass = full === "adv" ? "v-card__mode--adv" : "v-card__mode--dis";
    const cardClass = full === "adv" ? "v-card--adv" : "v-card--dis";

    const content = `
      <div class="v-card v-card--roll ${cardClass}">
        <div class="v-card__header">
          <div class="v-card__title">
            ${escapeHtml(actorName)} бросает <${escapeHtml(checkName)}>
            <span class="v-card__mode ${modeClass}">${modeLabel}</span>
          </div>
          <div class="v-card__sub">Пул: ${pool}</div>
        </div>

        <div class="v-card__row v-card__row--big">
          <div class="v-card__biglabel">Успехи</div>
          <div class="v-card__bigvalue">${chosen.successes}</div>
        </div>

        ${renderFaces(chosen.results)}
      </div>
    `;

    if (!silent) {
      const rollsForChat = [a.roll, b.roll].filter(Boolean);
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker(),
        content,
        rolls: rollsForChat,
      });
    }

    return {
      roll: chosen.roll,
      results: chosen.results,
      successes: chosen.successes,
      rerolls: [],
      fullMode: full,
    };
  }

  let luckCount = Number(luck ?? 0);
  let unluckCount = Number(unluck ?? 0);
  if (!Number.isFinite(luckCount)) luckCount = 0;
  if (!Number.isFinite(unluckCount)) unluckCount = 0;

  if (luckCount === 0 && unluckCount === 0) {
    const m = String(mode ?? "normal");
    if (m === "adv") luckCount = 1;
    if (m === "dis") unluckCount = 1;
  }

  luckCount = clamp(Math.round(luckCount), 0, 20);
  unluckCount = clamp(Math.round(unluckCount), 0, 20);
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

  const base = await rollOnce();
  const roll = base.roll;
  const results = Array.isArray(base.results) ? base.results : [];
  const rerollRolls = [];

  const applyReroll = async (index, preferHigher) => {
    const before = results[index];
    const rr = await rollDieOnce(useDieRoller);
    const after = rr.result;
    const chosen = preferHigher ? Math.max(before, after) : Math.min(before, after);
    results[index] = chosen;
    if (rr.roll) rerollRolls.push(rr.roll);
    return { index, before, after, chosen };
  };

  const rerolls = [];
  for (let i = 0; i < luckCount; i++) {
    const idx = pickIndex(results, false);
    const info = await applyReroll(idx, true);
    rerolls.push({ kind: "luck", ...info });
  }
  for (let i = 0; i < unluckCount; i++) {
    const idx = pickIndex(results, true);
    const info = await applyReroll(idx, false);
    rerolls.push({ kind: "unluck", ...info });
  }

  const successes = results.reduce((acc, r) => acc + dvSuccesses(r), 0);

  const parts = [];
  if (luckCount > 0) parts.push(formatAdvantage(luckCount));
  if (unluckCount > 0) parts.push(formatDisadvantage(unluckCount));
  const modeLabel = parts.length ? parts.join(" / ") : "Обычный";

  let modeClass = "v-card__mode--normal";
  let cardClass = "";
  if (luckCount > 0 && unluckCount === 0) {
    modeClass = "v-card__mode--adv";
    cardClass = "v-card--adv";
  } else if (unluckCount > 0 && luckCount === 0) {
    modeClass = "v-card__mode--dis";
    cardClass = "v-card--dis";
  }

  const content = `
    <div class="v-card v-card--roll ${cardClass}">
      <div class="v-card__header">
        <div class="v-card__title">
          ${escapeHtml(actorName)} бросает <${escapeHtml(checkName)}>
          <span class="v-card__mode ${modeClass}">${modeLabel}</span>
        </div>
        <div class="v-card__sub">Пул: ${pool}</div>
      </div>

      <div class="v-card__row v-card__row--big">
        <div class="v-card__biglabel">Успехи</div>
        <div class="v-card__bigvalue">${successes}</div>
      </div>

      ${renderFaces(results)}
    </div>
  `;

  if (!silent) {
    const rollsForChat = [roll, ...rerollRolls].filter(Boolean);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(),
      content,
      rolls: rollsForChat,
    });
  }

  return { roll, results, successes, rerolls };
}
