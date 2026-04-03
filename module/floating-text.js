/**
 * Vitruvium Floating Combat Text
 * Показывает всплывающий текст урона/лечения над токеном при изменении HP
 */

// Хранилище старых значений HP для расчёта разницы
const _oldHpValues = new Map();

// Throttle для предотвращения спама
const _throttleTimers = new Map();

/**
 * Создает всплывающий текст урона или лечения над токеном
 * @param {Token} token - Объект токена на сцене
 * @param {number} damage - Значение изменения HP (отрицательное = урон, положительное = лечение)
 * @param {string|null} stateName - Название состояния (опционально)
 */
export function showFloatingText(token, damage, stateName = null) {
  if (!token?.visible) return;

  // Проверяем, это состояние или урон/лечение
  const isState = stateName && typeof stateName === "string";
  const textToShow = isState ? stateName : null;

  // Для состояний показываем название, для урона/лечения - число
  let displayText;
  if (textToShow) {
    displayText = textToShow;
  } else {
    const value = Math.round(Number(damage) || 0);
    if (value === 0) return;
    displayText = value < 0 ? `-${Math.abs(value)}` : `+${value}`;
  }

  const center = token.center;
  if (!center || !canvas) return;

  // Используем встроенную функцию FoundryVTT для всплывающего текста
  canvas.interface.createScrollingText(center, displayText, {
    anchor: CONST.TEXT_ANCHOR_POINTS.CENTER,
    direction: isState
      ? CONST.TEXT_ANCHOR_POINTS.BOTTOM
      : damage < 0
        ? CONST.TEXT_ANCHOR_POINTS.TOP
        : CONST.TEXT_ANCHOR_POINTS.BOTTOM,
    distance: 50,
    fontSize: 32,
    fill: isState ? 0x4488ff : damage < 0 ? 0xff4444 : 0x44ff88,
    stroke: 0x000000,
    strokeThickness: 4,
    jitter: 0.25,
    duration: 2000,
  });
}

/**
 * Отправляет событие урона через сокет
 */
function emitDamageEvent(actorId, diff) {
  if (!game.socket) return;

  game.socket.emit("system.vitruvium", {
    type: "floatingText",
    actorId,
    diff,
  });
}

/**
 * Throttle функция
 */
function throttle(func, limit, key) {
  const now = Date.now();
  const lastRun = _throttleTimers.get(key) || 0;

  if (now - lastRun >= limit) {
    _throttleTimers.set(key, now);
    func();
  }
}

/**
 * Обработчик изменений актора
 */
export function setupFloatingTextHook() {
  // Слушаем события от других клиентов
  if (game.socket) {
    game.socket.on("system.vitruvium", (data) => {
      if (data.type !== "floatingText") return;

      const { actorId, diff } = data;
      const actor = game.actors.get(actorId);
      if (!actor) return;

      // Показываем на всех токенах актора (включая не-привязанные)
      for (const scene of game.scenes) {
        if (!scene.isOwner) continue;
        const tokens = scene.tokens.filter((t) => t.actorId === actorId);
        for (const tokenDoc of tokens) {
          const token = tokenDoc.object;
          if (token?.visible) {
            showFloatingText(token, diff);
          }
        }
      }

      // Также показываем на активных токенах
      const tokens = actor.getActiveTokens();
      for (const token of tokens) {
        showFloatingText(token, diff);
      }
    });
  }

  // preUpdateActor - сохраняем старое значение HP ПЕРЕД обновлением
  Hooks.on("preUpdateActor", (actor, change, options, userId) => {
    const hpChange = change.system?.attributes?.hp?.value;
    if (hpChange === undefined) return;

    // Сохраняем текущее (старое) значение HP
    const oldHp = actor.system?.attributes?.hp?.value ?? 0;
    _oldHpValues.set(actor.id, { oldHp, userId });
  });

  // Хук на изменение HP - срабатывает при любом изменении актора
  Hooks.on("updateActor", (actor, change, options, userId) => {
    const hpChange = change.system?.attributes?.hp?.value;
    if (hpChange === undefined) return;

    // Получаем сохранённое старое значение
    const savedData = _oldHpValues.get(actor.id);
    // Если preUpdate не сработал на этом клиенте, локально не считаем разницу,
    // иначе знак урона/лечения может быть неверным (например oldHp=0).
    // Корректный diff придёт через socket-событие от клиента, который сделал update.
    if (!savedData) return;
    const oldHp = savedData.oldHp;
    const newHp = Number(hpChange);
    const diff = newHp - oldHp;

    // Очищаем сохранённое значение
    _oldHpValues.delete(actor.id);

    if (diff === 0) return;

    const throttleKey = `hp-${actor.id}`;

    throttle(
      () => {
        emitDamageEvent(actor.id, diff);

        // Собираем все токены в Set для избежания дублирования
        const tokensToShow = new Set();

        // Добавляем токены со всех сцен
        for (const scene of game.scenes) {
          if (!scene.isOwner) continue;
          const tokens = scene.tokens.filter((t) => t.actorId === actor.id);
          for (const tokenDoc of tokens) {
            const token = tokenDoc.object;
            if (token?.visible) {
              tokensToShow.add(token);
            }
          }
        }

        // Добавляем активные токены
        const activeTokens = actor.getActiveTokens();
        for (const token of activeTokens) {
          if (token?.visible) {
            tokensToShow.add(token);
          }
        }

        for (const token of tokensToShow) {
          showFloatingText(token, diff);
        }
      },
      100,
      throttleKey,
    );
  });
}
