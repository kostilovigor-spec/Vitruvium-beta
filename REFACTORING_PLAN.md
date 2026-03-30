# 📋 Пошаговый план рефакторинга проекта Vitruvium

## 🎯 Цели рефакторинга

1. **Устранить дублирование кода** — выделить общие функции и базовые классы
2. **Разделить ответственность** — разбить монолитные файлы на модули
3. **Улучшить тестируемость** — уменьшить глобальное состояние
4. **Упростить поддержку** — добавить документацию, удалить legacy-код
5. **Повысить производительность** — оптимизировать обработку эффектов

---

## 📁 Этап 1: Подготовка инфраструктуры

### 1.1. Создать `module/utils.js`
**Задачи:**
- [ ] Выделить helper-функции: `clamp`, `num`, `esc`, `toRounds`
- [ ] Добавить функции для работы с FormData
- [ ] Добавить функции для безопасной работы с вложенными объектами
- [ ] Экспортировать все утилиты

**Файлы для изменения:**
- `+ module/utils.js` (новый)
- `module/character-sheet.js`
- `module/npc-sheet.js`
- `module/ability-sheet.js`
- `module/item-sheet.js`
- `module/skill-sheet.js`
- `module/combat.js`
- `module/effects.js`

**Пример содержимого utils.js:**
```javascript
export const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

export const num = (v, d = 0) => {
  const x = Number(v);
  return Number.isNaN(x) ? d : x;
};

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const toRounds = (v, d = 0) => Math.max(0, Math.round(num(v, d)));

export const getNested = (obj, path, defaultValue) => {
  return path.split(".").reduce((acc, key) => acc?.[key], obj) ?? defaultValue;
};

export const setNested = (obj, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((acc, key) => (acc[key] = acc[key] || {}), obj);
  target[last] = value;
};
```

---

### 1.2. Создать `module/config.js`
**Задачи:**
- [ ] Вынести константы атрибутов
- [ ] Вынести формулы (HP, Speed)
- [ ] Вынести категории предметов и способностей
- [ ] Вынести иконки и метки

**Файлы для изменения:**
- `+ module/config.js` (новый)
- `module/character-sheet.js`
- `module/npc-sheet.js`
- `module/effects.js`

**Пример содержимого config.js:**
```javascript
export const ATTRIBUTES = {
  condition: { label: "Самочувствие", icon: "♥", min: 1, max: 6 },
  attention: { label: "Внимание", icon: "◎", min: 1, max: 6 },
  movement: { label: "Движение", icon: "✜", min: 1, max: 6 },
  combat: { label: "Сражение", icon: "⚔", min: 1, max: 6 },
  thinking: { label: "Мышление", icon: "✦", min: 1, max: 6 },
  communication: { label: "Общение", icon: "☉", min: 1, max: 6 },
};

export const HP_FORMULA = {
  basePerCondition: 8,
};

export const SPEED_BASE = 5;

export const ITEM_CATEGORIES = {
  weapon: "Оружие",
  equipment: "Снаряжение",
  consumables: "Расходники",
  trinkets: "Безделушки",
  tools: "Инструменты",
  loot: "Добыча",
};

export const ABILITY_TYPES = {
  primary: "Основные",
  secondary: "Вторичные",
  other: "Остальные",
};

export const INSPIRATION = {
  baseMax: 6,
  min: 0,
  max: 99,
};
```

---

### 1.3. Обновить `module/system.js`
**Задачи:**
- [ ] Импортировать новые модули
- [ ] Переместить миграцию в отдельный файл `module/migration.js`
- [ ] Добавить логирование для отладки

**Файлы для изменения:**
- `module/system.js`
- `+ module/migration.js` (новый)

---

### 1.4. Удалить legacy-файлы
**Задачи:**
- [ ] Удалить `styles/system.legacy.css`
- [ ] Обновить `styles/system.css` (убрать импорт)

**Файлы для изменения:**
- `- styles/system.legacy.css` (удалить)
- `styles/system.css`

---

**✅ Результат этапа 1:**
- Все утилиты в одном месте
- Константы централизованы
- Legacy-код удалён
- Готово к использованию в других модулях

---

## 📁 Этап 2: Базовые классы для листов

### 2.1. Создать `module/sheets/base-sheet.js`
**Задачи:**
- [ ] Создать базовый класс `VitruviumActorSheet`
- [ ] Вынести общую логику атрибутов (+/- кнопки)
- [ ] Вынести общий `rollModeDialog()`
- [ ] Вынести обработку вдохновения
- [ ] Вынести обработку extra dice

**Файлы для изменения:**
- `+ module/sheets/base-sheet.js` (новый)
- `module/character-sheet.js`
- `module/npc-sheet.js`

**Структура базового класса:**
```javascript
export class VitruviumActorSheet extends ActorSheet {
  // Общие обработчики
  _onAttrInc(event);
  _onAttrDec(event);
  _onInspInc(event);
  _onInspDec(event);
  _onExtraInc(event);
  _onExtraDec(event);
  
  // Общий диалог броска
  async rollModeDialog(title);
  
  // Утилиты
  clamp(n, min, max);
  num(v, d);
}
```

---

### 2.2. Создать `module/sheets/base-item-sheet.js`
**Задачи:**
- [ ] Создать базовый класс `VitruviumItemSheet`
- [ ] Вынести режим редактирования описания
- [ ] Вынести рендеринг эффектов
- [ ] Вынести обработку иконки

**Файлы для изменения:**
- `+ module/sheets/base-item-sheet.js` (новый)
- `module/ability-sheet.js`
- `module/item-sheet.js`
- `module/skill-sheet.js`

---

### 2.3. Создать `module/sheets/index.js`
**Задачи:**
- [ ] Экспортировать все классы листов

**Файлы для изменения:**
- `+ module/sheets/index.js` (новый)

---

**✅ Результат этапа 2:**
- Базовые классы для всех листов
- Устранено 70% дублирования между character/npc
- Устранено 80% дублирования между item-листами

---

## 📁 Этап 3: Рефакторинг character-sheet.js и npc-sheet.js

### 3.1. character-sheet.js
**Задачи:**
- [ ] Наследовать от `VitruviumActorSheet`
- [ ] Удалить дублирующиеся методы
- [ ] Вынести бизнес-логику в отдельные модули
- [ ] Разбить `getData()` на подфункции

**Структура после рефакторинга:**
```javascript
import { VitruviumActorSheet } from "./sheets/base-sheet.js";
import { collectCharacterData } from "./sheets/character-data.js";
import { handleCharacterActions } from "./sheets/character-actions.js";

export class VitruviumCharacterSheet extends VitruviumActorSheet {
  getData() {
    return collectCharacterData(this);
  }
  
  activateListeners(html) {
    super.activateListeners(html);
    handleCharacterActions(this, html);
  }
}
```

**Новые файлы:**
- `+ module/sheets/character-data.js`
- `+ module/sheets/character-actions.js`

---

### 3.2. npc-sheet.js
**Задачи:**
- [ ] Наследовать от `VitruviumActorSheet`
- [ ] Удалить дублирующиеся методы
- [ ] Оставить только NPC-специфичную логику

**Файлы для изменения:**
- `module/npc-sheet.js`

---

**✅ Результат этапа 3:**
- character-sheet.js: ~400 строк (было 1187)
- npc-sheet.js: ~150 строк (было 480)
- Чёткое разделение общей и специфичной логики

---

## 📁 Этап 4: Рефакторинг item-листов

### 4.1. ability-sheet.js
**Задачи:**
- [ ] Наследовать от `VitruviumItemSheet`
- [ ] Удалить дублирующийся код
- [ ] Оставить только специфику способностей

**Файлы для изменения:**
- `module/ability-sheet.js`

---

### 4.2. item-sheet.js
**Задачи:**
- [ ] Наследовать от `VitruviumItemSheet`
- [ ] Удалить дублирующийся код
- [ ] Оставить только специфику предметов

**Файлы для изменения:**
- `module/item-sheet.js`

---

### 4.3. skill-sheet.js
**Задачи:**
- [ ] Наследовать от `VitruviumItemSheet`
- [ ] Удалить дублирующийся код
- [ ] Оставить только специфику навыков/состояний

**Файлы для изменения:**
- `module/skill-sheet.js`

---

**✅ Результат этапа 4:**
- Все item-листы используют базовый класс
- Устранено 80% дублирования
- Единый стиль обработки эффектов

---

## 📁 Этап 5: Разделение combat.js на модули

### 5.1. Создать `module/combat/attack.js`
**Задачи:**
- [ ] Вынести логику атаки оружием
- [ ] Вынести диалог атаки
- [ ] Вынести расчёт бросков атаки

**Файлы для изменения:**
- `+ module/combat/attack.js` (новый)

---

### 5.2. Создать `module/combat/defense.js`
**Задачи:**
- [ ] Вынести логику уклонения
- [ ] Вынести логику блока
- [ ] Вынести расчёт защиты

**Файлы для изменения:**
- `+ module/combat/defense.js` (новый)

---

### 5.3. Создать `module/combat/damage.js`
**Задачи:**
- [ ] Вынести расчёт урона
- [ ] Вынести применение урона к HP
- [ ] Вынести обработку брони

**Файлы для изменения:**
- `+ module/combat/damage.js` (новый)

---

### 5.4. Создать `module/combat/cards.js`
**Задачи:**
- [ ] Вынести рендеринг чат-карточек
- [ ] Вынести шаблоны карточек атаки/защиты/урона

**Файлы для изменения:**
- `+ module/combat/cards.js` (новый)

---

### 5.5. Создать `module/combat/index.js`
**Задачи:**
- [ ] Экспортировать все функции combat

**Файлы для изменения:**
- `+ module/combat/index.js` (новый)

---

### 5.6. Обновить combat.js
**Задачи:**
- [ ] Оставить только экспорт из подмодулей
- [ ] Или удалить, если не нужен

**Файлы для изменения:**
- `module/combat.js` (удалить или оставить как wrapper)

---

**✅ Результат этапа 5:**
- combat.js: 2513 строк → 5 файлов по ~400-500 строк
- Каждый модуль отвечает за одну задачу
- Легче тестировать и поддерживать

---

## 📁 Этап 6: Удаление legacy-кода и чистка effects.js

### 6.1. Удалить LEGACY_EFFECT_KEY_MAP
**Задачи:**
- [ ] Проверить, все ли эффекты используют новые ключи
- [ ] Удалить маппинг из `effects.js`
- [ ] Обновить документацию

**Файлы для изменения:**
- `module/effects.js`

---

### 6.2. Упростить collectEffectTotals
**Задачи:**
- [ ] Удалить обработку legacy-ключей
- [ ] Оптимизировать цикл сборки эффектов

**Файлы для изменения:**
- `module/effects.js`

---

### 6.3. Добавить обработку ошибок
**Задачи:**
- [ ] Обернуть критичные участки в try/catch
- [ ] Добавить логирование ошибок

**Файлы для изменения:**
- `module/effects.js`
- `module/combat/*.js`
- `module/system.js`

---

**✅ Результат этапа 6:**
- effects.js чище на ~100 строк
- Нет путаницы со старыми ключами
- Ошибки логируются, а не игнорируются

---

## 📁 Этап 7: Финальная чистка и документация

### 7.1. Добавить JSDoc документацию
**Задачи:**
- [ ] Документировать все публичные функции
- [ ] Добавить typedef для сложных типов

**Файлы для изменения:**
- Все файлы в `module/`

---

### 7.2. Исправить несогласованные имена
**Задачи:**
- [ ] `startAbilityAttackFlow` → `startAbilityFlow`
- [ ] Унифицировать имена функций

**Файлы для изменения:**
- `module/combat.js`
- `module/npc-sheet.js`
- `module/character-sheet.js`

---

### 7.3. Обновить README и документацию
**Задачи:**
- [ ] Обновить `README.md` с новой структурой
- [ ] Обновить `docs/DEV.md` для разработчиков
- [ ] Добавить примеры использования API

**Файлы для изменения:**
- `README.md`
- `docs/DEV.md`

---

### 7.4. Обновить version в system.json
**Задачи:**
- [ ] Увеличить версию до 0.2.0 (major changes)

**Файлы для изменения:**
- `system.json`

---

**✅ Результат этапа 7:**
- Полная документация
- Согласованные имена
- Готово к передаче другим разработчикам

---

## 📊 Итоговая структура после рефакторинга

```
module/
├── system.js              # Точка входа
├── config.js              # Константы и конфигурация
├── utils.js               # Общие утилиты
├── migration.js           # Миграции данных
├── effects.js             # Система эффектов
├── rolls.js               # Броски кубов
├── initiative.js          # Инициатива
├── dv-die.js              # Кастомный куб dV
├── dice-so-nice.js        # Интеграция DSN
├── auto-animations.js     # Анимации
├── chat-visibility.js     # Видимость чата
├── state-library.js       # Библиотека состояний
├── state-duration.js      # Длительность состояний
├── floating-text.js       # Всплывающий текст
├── tests.js               # Юнит-тесты
├── sheets/                # Классы листов
│   ├── index.js
│   ├── base-sheet.js
│   ├── base-item-sheet.js
│   ├── character-data.js
│   ├── character-actions.js
│   ├── character-sheet.js
│   ├── npc-sheet.js
│   ├── ability-sheet.js
│   ├── item-sheet.js
│   └── skill-sheet.js
└── combat/                # Боевая система
    ├── index.js
    ├── attack.js
    ├── defense.js
    ├── damage.js
    └── cards.js
```

---

## 📈 Ожидаемые результаты

| Метрика | До | После | Улучшение |
|---------|-----|-------|-----------|
| Строк в character-sheet.js | 1187 | ~400 | -66% |
| Строк в npc-sheet.js | 480 | ~150 | -69% |
| Строк в combat.js | 2513 | ~500 (x5 файлов) | Модульность |
| Дублирование кода | ~70% | ~10% | -85% |
| Файлов с helper-функциями | 10+ | 1 (utils.js) | Централизация |
| Legacy-код | Есть | Нет | 100% удалено |

---

## ⏱️ Оценка времени

| Этап | Сложность | Время |
|------|-----------|-------|
| 1. Инфраструктура | Низкая | 2-3 часа |
| 2. Базовые классы | Средняя | 4-6 часов |
| 3. Actor-листы | Средняя | 4-6 часов |
| 4. Item-листы | Низкая | 2-3 часа |
| 5. Combat-модули | Высокая | 8-10 часов |
| 6. Legacy-чистка | Низкая | 1-2 часа |
| 7. Документация | Средняя | 3-4 часа |
| **Итого** | | **24-34 часа** |

---

## 🚀 Быстрый старт

Начните с **Этапа 1** — он даст наибольшую пользу с наименьшими усилиями:
1. Создать `utils.js`
2. Создать `config.js`
3. Удалить `system.legacy.css`

Это сразу улучшит поддерживаемость кода.
