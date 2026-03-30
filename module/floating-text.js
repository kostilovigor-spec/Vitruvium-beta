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
 */
export function showFloatingText(token, damage) {
  console.log("Vitruvium | showFloatingText вызван", {
    token: token?.id,
    damage,
  });

  if (!token?.visible) {
    console.log("Vitruvium | Токен не видим");
    return;
  }

  const value = Math.round(Number(damage) || 0);
  if (value === 0) {
    console.log("Vitruvium | Значение равно 0");
    return;
  }

  const center = token.center;
  console.log("Vitruvium | center =", center);

  if (!center || !canvas) {
    console.log("Vitruvium | Нет center или canvas");
    return;
  }

  // Используем встроенную функцию FoundryVTT для всплывающего текста
  canvas.interface.createScrollingText(
    center,
    value < 0 ? `-${Math.abs(value)}` : `+${value}`,
    {
      anchor: CONST.TEXT_ANCHOR_POINTS.CENTER,
      direction:
        value < 0
          ? CONST.TEXT_ANCHOR_POINTS.TOP
          : CONST.TEXT_ANCHOR_POINTS.BOTTOM,
      distance: 50,
      fontSize: 32,
      fill: value < 0 ? 0xff4444 : 0x44ff88,
      stroke: 0x000000,
      strokeThickness: 4,
      jitter: 0.25,
      duration: 2000,
    },
  );

  console.log("Vitruvium | Текст создан");
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
  console.log("Vitruvium | setupFloatingTextHook вызван");

  // Слушаем события от других клиентов
  if (game.socket) {
    game.socket.on("system.vitruvium", (data) => {
      console.log("Vitruvium | Получено событие сокета", data);
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
  console.log("Vitruvium | Регистрируем хук preUpdateActor");
  Hooks.on("preUpdateActor", (actor, change, options, userId) => {
    const hpChange = change.system?.attributes?.hp?.value;
    if (hpChange === undefined) return;

    // Сохраняем текущее (старое) значение HP
    const oldHp = actor.system?.attributes?.hp?.value ?? 0;
    _oldHpValues.set(actor.id, { oldHp, userId });
    console.log(
      "Vitruvium | preUpdateActor: сохранено oldHp =",
      oldHp,
      "для",
      actor.name,
    );
  });

  // Хук на изменение HP - срабатывает при любом изменении актора
  console.log("Vitruvium | Регистрируем хук updateActor");
  Hooks.on("updateActor", (actor, change, options, userId) => {
    console.log("Vitruvium | updateActor сработал", {
      actor: actor?.name,
      change: JSON.stringify(change),
      userId,
      currentUserId: game.user?.id,
    });

    const hpChange = change.system?.attributes?.hp?.value;
    if (hpChange === undefined) {
      console.log("Vitruvium | HP не изменилось в change.system");
      return;
    }

    // Получаем сохранённое старое значение
    const savedData = _oldHpValues.get(actor.id);
    const oldHp = savedData?.oldHp ?? 0;
    const newHp = Number(hpChange);
    const diff = newHp - oldHp;

    console.log("Vitruvium | HP изменилось", { oldHp, newHp, diff });

    // Очищаем сохранённое значение
    _oldHpValues.delete(actor.id);

    if (diff === 0) return;

    const throttleKey = `hp-${actor.id}`;

    throttle(
      () => {
        console.log("Vitruvium | throttle вызов");
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

        console.log("Vitruvium | Показываем на токенах:", tokensToShow.size);
        for (const token of tokensToShow) {
          showFloatingText(token, diff);
        }
      },
      100,
      throttleKey,
    );
  });

  console.log("Vitruvium | Хуки зарегистрированы");
}
