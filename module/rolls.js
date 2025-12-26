export async function rollSuccessDice({
  pool = 1,
  actorName = "Персонаж",
  checkName = "Проверка",
} = {}) {
  pool = Number(pool);
  if (Number.isNaN(pool)) pool = 1;
  pool = Math.min(Math.max(pool, 1), 20);

  const roll = await new Roll(`${pool}d6`).evaluate({ async: true });
  const results = roll.dice[0].results.map((r) => r.result);

  // Подсчёт успехов
  let successes = 0;
  for (const r of results) {
    if (r <= 3) continue;
    if (r <= 5) successes += 1;
    else successes += 2; // 6 = два обычных успеха
  }

  // Один тип значка успеха
  const successIcon = `<span class="v-success">♦</span>`;

  const successIcons =
    successes > 0
      ? successIcon.repeat(successes)
      : `<span class="v-success v-success--none">—</span>`;

  const content = `
    <div class="v-card">
      <div class="v-card__header">
        <div class="v-card__title">
          ${escapeHtml(actorName)} — проверка «${escapeHtml(checkName)}»
        </div>
      </div>

      <div class="v-card__row">
        <div class="v-card__label">Пул</div>
        <div class="v-card__value"><b>${pool}</b></div>
      </div>

      <div class="v-card__row">
        <div class="v-card__label">Успехи</div>
        <div class="v-card__value v-successes">
          ${successIcons}
        </div>
      </div>

      <div class="v-card__footer">
        <span class="v-rule">1–3 = 0 · 4–5 = 1 · 6 = 2</span>
      </div>
    </div>
  `;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker(),
    content,
    rolls: [roll], // Dice So Nice остаётся активным
  });

  return { roll, results, successes };
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
