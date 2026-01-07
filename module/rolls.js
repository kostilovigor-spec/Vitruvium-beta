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
      : `<span class="v-success v-success--none"></span>`;

  const countSuccesses = (results) => {
    let successes = 0;
    for (const r of results) {
      if (r <= 3) continue;
      if (r <= 5) successes += 1;
      else successes += 2; // 6 = два обычных успеха
    }
    return successes;
  };

  const doOneRoll = async () => {
    const roll = await new Roll(`${pool}dV`).evaluate({ async: true });
    const results = roll.dice[0].results.map((r) => r.result);
    const successes = countSuccesses(results);
    return { roll, results, successes };
  };

  // ----- NORMAL -----
  if (m === "normal") {
    const r = await doOneRoll();

    const content = `
      <div class="v-card v-card--attr">
        <div class="v-card__header">
          <div class="v-card__title">
            ${escapeHtml(actorName)} — проверка «${escapeHtml(checkName)}»
          </div>
        </div>

        <div class="v-card__row">
          <div class="v-card__value" style="font-size: 18px;"><b>Пул: ${pool}</b></div>
        </div>

        <div class="v-card__row">
          <div class="v-card__value v-successes" style="font-size: 18px;">
            Успехи = ${r.successes} ${renderIcons(r.successes)}
          </div>
        </div>
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

  const modeLabel = isAdv ? "Преимущество" : "Помеха";
  const badge = isAdv ? "Adv" : "Dis";
  const cardClass = isAdv ? "v-card--adv" : "v-card--dis";

  const c1 = chosen === r1;
  const c2 = chosen === r2;

  const content = `
    <div class="v-card ${cardClass}">
      <div class="v-card__header">
        <div class="v-card__title">
          <span class="v-card__mode">${badge}</span>
          ${escapeHtml(actorName)} — проверка «${escapeHtml(
    checkName
  )}» (${modeLabel})
        </div>
      </div>

      <div class="v-card__row">
        <div class="v-card__value" style="font-size: 18px;"><b>Пул: ${pool}</b></div>
      </div>

      <div class="v-card__row">
        <div class="v-card__value" style="font-size: 16px;">
          Бросок 1: <b>${r1.successes}</b> ${renderIcons(r1.successes)}
          ${c1 ? `<span class="v-card__pick">выбран</span>` : ``}
        </div>
      </div>

      <div class="v-card__row">
        <div class="v-card__value" style="font-size: 16px;">
          Бросок 2: <b>${r2.successes}</b> ${renderIcons(r2.successes)}
          ${c2 ? `<span class="v-card__pick">выбран</span>` : ``}
        </div>
      </div>

      <div class="v-card__row">
        <div class="v-card__value v-successes" style="font-size: 18px;">
          Итог = <b>${chosen.successes}</b> ${renderIcons(chosen.successes)}
        </div>
      </div>
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker(),
    content,
    // Важно: передаём оба Roll, чтобы Dice So Nice показал оба броска
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
