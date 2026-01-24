# Vitruvium (Foundry VTT System)

Кастомная система для Foundry VTT. В основе — пул dV (d6), где 1–3 = 0 успехов, 4–5 = 1 успех, 6 = 2 успеха.

## Совместимость
- Foundry VTT: 12+ (проверено на 13)

## Быстрый старт
1) Установите систему в папку `Data/systems/Vitruvium`.
2) Создайте мир и выберите систему **Vitruvium Beta**.
3) Создайте актёра типа **character** или **npc**.
4) На листе персонажа настройте атрибуты, HP и Вдохновение.
5) Создавайте предметы (item), способности (ability), навыки (skill) и состояния (state).

## Механика бросков dV
- dV — это d6 с успехами:
  - 1–3: 0 успехов
  - 4–5: 1 успех
  - 6: 2 успеха
- **Преимущество/помеха** (luck/unluck): каждый счетчик даёт переброс одного куба.
- **Удачливый/неудачливый бросок** (fullMode): полный переброс всего пула, берется лучшая/худшая попытка.

## Данные актёра (Actor)
Источник: `template.json`

### Типы актёров
- `character`
- `npc`

### Атрибуты (character)
- `condition`, `attention`, `movement`, `combat`, `thinking`, `communication` (1–6)
- `attack`, `armor`, `level`
- `inspiration` `{ value, max }`
- `hp` `{ value, max }`

### Атрибуты (npc)
- `condition`, `attention`, `movement`, `combat`, `thinking`, `communication`
- `inspiration` `{ value, max }`
- `hp` `{ value, max }`

### Формулы на листе персонажа
Источник: `module/character-sheet.js`
- **Макс. HP** = `condition * 8 + эффект hpMax`
- **Вдохновение (max)** = `base max + эффект inspMax`
- **Скорость** = `5 + movement + эффект speed`
- **Броня** = сумма `armorBonus` всех экипированных предметов

## Предметы (Item)
Источник: `template.json`

### Типы предметов
- `ability` — способности
- `item` — инвентарь/оружие/броня
- `skill` — навыки
- `state` — состояния

### Поля ability
- `cost`, `level`, `active`
- `attackAttr` (атрибут атаки)
- `rollDamageBase`, `rollDamageDice`
- `rollSaveBase`, `rollSaveDice`
- `description`, `effects`

### Поля item
- `quantity`, `price`, `equipped`
- `attackAttr`, `attackBonus`
- `armorBonus`, `damage`
- `isShield`, `isHeavyArmor`
- `description`, `effects`

### Поля skill/state
- `description`, `effects`

## Эффекты
Источник: `module/effects.js`

Эффекты складываются из предметов:
- `item` — только если предмет экипирован
- `ability` — только если способность активна
- `skill` и `state` — всегда

Поддерживаемые ключи:
- `condition` — Самочувствие
- `attention` — Внимание
- `movement` — Движение
- `combat` — Сражение
- `thinking` — Мышление
- `communication` — Общение
- `rollAdv` — все броски: преимущество
- `rollDis` — все броски: помеха
- `rollFullAdv` — все броски: удачливый (полный переброс)
- `rollFullDis` — все броски: неудачливый (полный переброс)
- `hpMax` — макс. HP
- `inspMax` — макс. Вдохновение
- `speed` — скорость
- `weaponAdv` — атака оружием: преимущество
- `weaponDis` — атака оружием: помеха
- `dodgeAdv` — уклонение: преимущество
- `dodgeDis` — уклонение: помеха

## Бой
Источник: `module/combat.js`

### Атака оружием
1) Атакующий выбирает атрибут и режим броска.
2) Бросок атаки = пул атрибута.
3) Урон: базовый урон оружия + успехи атаки.
4) В чат приходит карточка атаки с кнопкой **Защита**.

### Защита
Защитник (или ГМ) выбирает реакцию:
- **Уклонение** — пул `movement`
- **Блок** — пул `condition`
- При тяжёлой броне уклонение недоступно (только принять удар).

### Урон (текущая модель)
Пусть:
- `weaponDamage` — базовый урон оружия
- `atkS` — успехи атаки
- `defS` — успехи защиты
- `armorFull` — броня со щитом
- `armorNoShield` — броня без щита

**Блок**
`damage = max(0, weaponDamage + (atkS - defS) - armorFull)`

**Уклонение**
`hit = atkS > defS`
Если промах, применяется половина брони (минимум 1):
`armorHalf = max(1, floor(armorNoShield / 2))`
`damage = max(0, weaponDamage + (atkS - defS) - appliedArmor)`

### Особенности для NPC и ГМа
- Если атакует NPC без владельца, игроки не видят результаты атаки — только запрос защиты.
- После защиты клиент ГМа получает скрытую карточку разрешения урона.
- Урон применяется кнопкой **Применить урон** (только ГМ).

### Атака способностью
Источник: `module/combat.js`, `module/ability-sheet.js`
- Способность может иметь:
  - **урон** (base + dV)
  - **спасбросок** (сложность)
- Для урона производится бросок атаки (пул атрибута).
- Защита — уклонение (movement).
- **Урон способности**: `abilityValue + (atkS - defS)`
  где `abilityValue = rollDamageBase + successes(rollDamageDice)`
- **Спасбросок**: `defS >= saveValue`, где `saveValue = rollSaveBase + successes(rollSaveDice)`

## Инициатива
Источник: `module/initiative.js`
- Инициатива = успехи по `movement`.
- Встроен диалог выбора режима (полный переброс / преимущество / помеха).
- При равенстве между PC и NPC — делается “бросок удачи” игрока, сдвигающий инициативу на ±0.01.

## Интеграции
- **Dice So Nice**: `module/dice-so-nice.js`
  Поддерживается пресет `dV` на основе d6. Текстуры лежат в `assets/dice/`.
- **Automated Animations**: `module/auto-animations.js`
  Автозапуск анимаций для действий и предметов, если модуль активен.

## Публичное API
Источник: `module/system.js`
- `game.vitruvium.startWeaponAttackFlow(actor, weaponItem)`
- `game.vitruvium.startAbilityAttackFlow(actor, abilityItem)`
- `game.vitruvium.runTests()` — запуск встроенных тестов (см. `module/tests.js`)

## Структура проекта
- `module/` — основная логика системы
  - `system.js` — регистрация листов, бросков, хук и API
  - `combat.js` — атаки/защита/урон/чат-карточки
  - `initiative.js` — инициатива и тай-брейк
  - `rolls.js` — базовые броски dV
  - `effects.js` — эффекты и модификаторы
  - `*-sheet.js` — листы актёров и предметов
- `templates/` — Handlebars-шаблоны листов
- `styles/` — стили системы и чата
- `assets/` — графика (включая кубы)

## Полезные заметки
- Базовые значения и типы описаны в `template.json`.
- Совместимость и версии — в `system.json`.
