# Vitruvium — Документация для разработчиков

Этот документ описывает архитектуру, потоки данных и точки расширения системы Vitruvium для Foundry VTT.

## Загрузка и инициализация
Источник: `system.json`, `module/system.js`

- Foundry подключает модули из `system.json` (поле `esmodules`).
- Главная инициализация в `module/system.js`:
  - регистрируются листы актёров и предметов;
  - подключается кастомная кость `dV`;
  - патчится инициатива (override `Combat.prototype.rollInitiative`);
  - добавляется публичное API в `game.vitruvium`.

## Модель данных
Источник: `template.json`

### Actor
Типы: `character`, `npc`.
- базовые атрибуты: `condition`, `attention`, `movement`, `combat`, `thinking`, `communication`
- боевые поля: `attack`, `armor`, `level`
- ресурсы: `inspiration { value, max }`, `hp { value, max }`

### Item
Типы: `ability`, `item`, `skill`, `state`.
- `ability`: cost/level/active, атрибут атаки, настройки урона/спасброска, effects
- `item`: экипировка, бонусы атаки/брони, флаги щита/тяжёлой брони, effects
- `skill`/`state`: описание + effects

## Листы (Sheets)
Источник: `module/*-sheet.js`

- `VitruviumCharacterSheet` — основной лист персонажа.
- `VitruviumNPCSheet` — наследник для NPC.
- `VitruviumAbilitySheet`, `VitruviumItemSheet`, `VitruviumSkillSheet`, `VitruviumEffectSheet`.

Ключевые моменты:
- расчёт **HP max**, **Вдохновения**, **скорости** и **брони** происходит в `getData()` листа персонажа.
- переключение режимов редактирования описаний — локальная логика в каждом sheet.
- несколько значений сохраняются в флагах (`extraDice`, `activeTab`).

## Броски и dV
Источник: `module/dv-die.js`, `module/rolls.js`, `module/dice-so-nice.js`

- `dV` — кастомная кость на базе `d6`.
- Успехи: 1–3 = 0, 4–5 = 1, 6 = 2.
- `rollSuccessDice()` — универсальный бросок пула dV с поддержкой
  - преимущества/помехи (переброс отдельных кубов)
  - полного переброса (fullMode: adv/dis)
- Интеграция Dice So Nice регистрирует текстуры и пресет dV.

## Эффекты
Источник: `module/effects.js`

- Эффекты собираются из `item` (если экипирован), `ability` (если активна), `skill`/`state` (всегда).
- `collectEffectTotals()` суммирует значения по ключам.
- `getGlobalRollModifiers()` возвращает adv/dis и fullMode для всех бросков.

## Бой: атака/защита/урон
Источник: `module/combat.js`

### Поток атаки оружием
1) игрок выбирает атрибут и режим броска (`attackDialog`).
2) бросок атаки (`rollPool`).
3) публикуется карточка атаки с кнопкой **Защита**.
4) защитник делает уклонение/блок → бросок защиты.
5) клиент ГМа получает скрытую просьбу рассчитать результат.
6) ГМ видит resolve‑карточку и может нажать **Применить урон**.

### Поток атаки способностью
- способность может иметь **урон** и/или **спасбросок**.
- урон считается формулой: `abilityValue + (atkS - defS)`.
- спасбросок считается по сложности `saveValue`.

### Флаги чата (ChatMessage)
Используется namespace `flags.vitruvium`:
- `kind: "attack"` — публичная карточка атаки
- `kind: "resolveRequest"` — скрытый запрос на расчёт (GM-only)
- `kind: "resolve"` — результат урона (GM-only)

Это позволяет не раскрывать игрокам данные атаки при NPC-атаках.

### Детальный data-flow combat.js

#### Оружие: от клика до урона
1) UI: на листе персонажа кнопка «Атака» вызывает `game.vitruvium.startWeaponAttackFlow()`.
2) `startWeaponAttackFlow()`:
   - открывает `attackDialog()` (атрибут, luck/unluck, fullMode);
   - вычисляет модификаторы (`collectEffectTotals`, `getGlobalRollModifiers`, `getWeaponRollMods`);
   - бросает пул `rollPool()`.
3) Если **нет цели** — публикуется карточка «атака без цели» и всё заканчивается.
4) Если есть цель:
   - создаётся публичная карточка атаки с кнопкой **Защита**;
   - при атаке NPC без владельца публикуется «запрос защиты» без результатов.
5) `Hooks.on("renderChatMessage")` вешает обработчик на кнопку **Защита**:
   - проверка `flags.vitruvium.kind === "attack"`;
   - защита доступна только владельцу цели или GM (`userCanDefend`).
6) Защитник выбирает реакцию (`defenseDialog()`):
   - **block** → пул `condition`;
   - **dodge** → пул `movement` (недоступен при тяжелой броне).
7) Публикуется **публичная** карточка защиты с результатами.
8) Создаётся **скрытая** (whisper GM) карточка‑запрос `resolveRequest` с полным контекстом атаки/защиты.
9) `Hooks.on("createChatMessage")` (GM-only) ловит `resolveRequest`:
   - считает урон `computeDamageCompact()`;
   - публикует GM‑only resolve‑карточку с кнопкой **Применить урон**;
   - удаляет message‑запрос (чтобы в чате не оставалась пустая строка).
10) Нажатие **Применить урон** (GM-only):
   - берёт `defenderTokenUuid` из флагов;
   - вычитает урон из `system.attributes.hp.value`.

#### Способность: от клика до урона/спасброска
1) UI: кнопка «Использовать способность» вызывает `startAbilityAttackFlow()`.
2) `startAbilityAttackFlow()`:
   - определяет режим (урон/спасбросок);
   - при уроне делает `attackDialog()` + `rollPool()` для атаки;
   - при уроне/спасброске кидает дополнительные `rollPool()` по dice-полям;
   - рассчитывает `damageValue` и `saveValue`.
3) Публикуется карточка атаки (или скрытая версия для NPC без владельца).
4) Защита работает так же, как при оружии: кнопка **Защита** → `resolveRequest` → GM‑resolve.
5) GM‑resolve при `attackKind: "ability"`:
   - урон: `computeAbilityDamage()`;
   - спасбросок: `defS >= saveValue`.

#### Ключевые хуки и обработчики
- `Hooks.once("ready")`: инжект CSS для chat cards.
- `Hooks.on("renderChatMessage")`: привязка кнопок **Защита** и **Применить урон**.
- `Hooks.on("createChatMessage")` (GM-only): расчёт урона из `resolveRequest`.

#### Основные поля флагов `flags.vitruvium`
- `kind`: `attack` | `resolveRequest` | `resolve`
- `attackKind`: `weapon` | `ability`
- `attackerTokenUuid`, `defenderTokenUuid`
- `weaponName`, `weaponDamage`
- `atkSuccesses`, `defSuccesses`, `defenseType`
- `abilityDamageBase`, `abilityDamageDice`, `abilityDamageValue`
- `abilitySaveBase`, `abilitySaveDice`, `abilitySaveValue`

## Инициатива
Источник: `module/initiative.js`

- Переопределяется `Combat.prototype.rollInitiative`.
- Инициатива = успехи по `movement`.
- При равенстве PC и NPC: бросок удачи, добавляющий ±0.01.

## Публичное API
Источник: `module/system.js`

- `game.vitruvium.startWeaponAttackFlow(actor, weaponItem)`
- `game.vitruvium.startAbilityAttackFlow(actor, abilityItem)`
- `game.vitruvium.runTests()`

## Тестирование
Источник: `module/tests.js`

В консоли Foundry:
- `game.vitruvium.runTests()`

Тесты проверяют:
- `computeDamageCompact()`
- `rollPool()`
- `rollSuccessDice()`

## Точки расширения
- **Новые эффекты**: добавьте ключ в `EFFECT_TARGETS` + обработайте в логике.
- **Новые типы Item**: обновите `system.json` и `template.json`, добавьте sheet.
- **Баланс боя**: формулы в `computeDamageCompact()` и `computeAbilityDamage()`.
- **Визуал**: карточки чата и CSS в `module/combat.js` и `styles/`.

## Полезные заметки
- Системный id: `game.system.id` должен совпадать с `system.json`.
- Не используйте sockets — GM‑резолв работает через `createChatMessage`.
- Любая логика, завязанная на UI, обычно живёт в соответствующих sheet.
