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
  const iconBlank = "–";
  const iconSingle = "♦";
  const iconDouble = "♦♦";
  return `
    <div class="v-faces v-compact-faces">
      ${results
        .map((r) => {
          const kind = dvFaceKind(r);
          const icon =
            kind === "double" ? iconDouble : kind === "single" ? iconSingle : iconBlank;
          return `<span class="v-face v-face--${kind}" title="${kind}">${icon}</span>`;
        })
        .join("")}
    </div>
  `;
}

export async function rollSuccessDice({
  pool = 1,
  actorName = "Персонаж",
  checkName = "Проверка",
  mode = "normal", // "normal" | "adv" | "dis"
} = {}) {
  pool = Number(pool);
  if (Number.isNaN(pool)) pool = 1;
  pool = Math.min(Math.max(pool, 1), 20);

  const m = String(mode ?? "normal");

  // Один тип значка успеха
  const successIcon = `<span class="v-success">♦</span>`;
  const renderIcons = (successes) =>
    successes > 0
      ? successIcon.repeat(successes)
      : `<span class="v-success v-success--none">—</span>`;

  const countSuccesses = (results) => {
    let successes = results.reduce((acc, r) => acc + dvSuccesses(r), 0);
return successes;
  };

  const doOneRoll = async () => {
    const roll = await new Roll(`${pool}dV`).evaluate();
    const results = roll.dice[0].results.map((r) => r.result);
    const successes = countSuccesses(results);
    return { roll, results, successes };
  };

  
// ----- NORMAL -----
if (m === "normal") {
  const r = await doOneRoll();

  const content = `
    <div class="v-card v-card--roll">
      <div class="v-card__header">
        <div class="v-card__title">
          ${escapeHtml(actorName)} — проверка «${escapeHtml(checkName)}»
          <span class="v-card__mode v-card__mode--normal">Normal</span>
        </div>
        <div class="v-card__sub">Пул: ${pool}</div>
      </div>

      <div class="v-card__row v-card__row--big">
        <div class="v-card__biglabel">УСПЕХИ</div>
        <div class="v-card__bigvalue">${r.successes}</div>
      </div>

      ${renderFaces(r.results)}
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker(),
    content,
    rolls: [r.roll],
  });

  return r;
}


  
  // ----- ADV / DIS -----
  const r1 = await doOneRoll();
  const r2 = await doOneRoll();

  const isAdv = m === "adv";
  const chosen = isAdv
    ? r1.successes >= r2.successes
      ? r1
      : r2
    : r1.successes <= r2.successes
    ? r1
    : r2;

  const badge = isAdv ? "Adv" : "Dis";
  const modeClass = isAdv ? "v-card__mode--adv" : "v-card__mode--dis";
  const cardClass = isAdv ? "v-card--adv" : "v-card--dis";

  const c1 = chosen === r1;
  const c2 = chosen === r2;

  const content = `
    <div class="v-card v-card--roll ${cardClass}">
      <div class="v-card__header">
        <div class="v-card__title">
          ${escapeHtml(actorName)} — проверка «${escapeHtml(checkName)}»
          <span class="v-card__mode ${modeClass}">${badge}</span>
        </div>
        <div class="v-card__sub">Пул: ${pool}</div>
      </div>

      <div class="v-card__row v-card__row--big">
        <div class="v-card__biglabel">УСПЕХИ</div>
        <div class="v-card__bigvalue">${chosen.successes}</div>
      </div>

      <div class="v-card__compare">
        <div class="v-card__cmp">
          <span class="v-card__cmpLabel">Бросок 1</span>
          <span class="v-card__cmpVal">${r1.successes}</span>
          ${c1 ? `<span class="v-card__chosen">выбран</span>` : ``}
        </div>
        <div class="v-card__cmp">
          <span class="v-card__cmpLabel">Бросок 2</span>
          <span class="v-card__cmpVal">${r2.successes}</span>
          ${c2 ? `<span class="v-card__chosen">выбран</span>` : ``}
        </div>
      </div>

      ${c1 ? renderFaces(r1.results) : renderFaces(r2.results)}
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker(),
    content,
    // Dice So Nice: показать оба броска
    rolls: [r1.roll, r2.roll],
  });

  return chosen;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}