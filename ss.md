# Задача: Удалить механику crit и заменить её на универсальную систему "разницы успехов"

---

## Цель

Полностью убрать:
- isCritical()
- все проверки crit
- все зависимости от crit

И заменить на:
→ универсальную систему:
"эффект срабатывает, если (atkSuccesses - defSuccesses) >= threshold"

---

## ЧАСТЬ 1: Удаление crit

Найти и удалить:

1. Функцию:
- isCritical(atk, def)

2. Все использования:
- crit ? dmg * 2 : dmg
- result.crit
- flags.crit
- UI (бейджи КРИТ, ×2 и т.д.)
- CRIT_ATTACK режим

3. Очистить:
- combat.js
- damage-resolver.js
- action-processor.js
- шаблоны

👉 Важно:
НЕ оставить ни одного зависимого вызова

---

## ЧАСТЬ 2: Введение margin (разницы успехов)

Добавить в результат броска:

margin = atkSuccesses - defSuccesses

Добавить в:
- damage resolver
- action processor (ctx.computed.margin)

---

## ЧАСТЬ 3: Новая система условий (ядро)

Создать модуль:

module/core/condition-resolver.js

Функция:

function checkCondition(condition, context) {
    // condition: { type: "margin", value: number }
    // context: { atk, def, margin }

    if (condition.type === "margin") {
        return context.margin >= condition.value;
    }

    return false;
}

Экспортировать:
ConditionResolver.checkCondition

---

## ЧАСТЬ 4: Замена CRIT_ATTACK

Удалить:
- applyMode === "CRIT_ATTACK"

Заменить на:

effect.condition = {
    type: "margin",
    value: number
}

---

## ЧАСТЬ 5: UI (способности / предметы)

Вместо:
- "при крите"

Сделать:

Поле:
"Наложить состояние при разнице успехов ≥ [число]"

---

### Реализация UI:

Добавить:
- number input (threshold)

Если поле пустое:
→ условие не используется

Если заполнено:
→ сохранять:

effect.condition = {
    type: "margin",
    value: X
}

---

## ЧАСТЬ 6: Применение условий

В местах, где сейчас:

if (crit) {
    applyEffect(...)
}

Заменить на:

if (ConditionResolver.checkCondition(effect.condition, context)) {
    applyEffect(...)
}

---

## ЧАСТЬ 7: Damage resolver

Удалить:
- умножение урона на 2

Оставить:
- только базовый урон

---

## ЧАСТЬ 8: Централизация

Убедиться:

- ВСЕ проверки условий идут через:
  ConditionResolver.checkCondition

- НЕТ:
  - прямых сравнений margin >= X в разных местах
  - дублирования логики

---

## ЧАСТЬ 9: Обратная совместимость

Если найдены старые данные:

applyMode === "CRIT_ATTACK"

→ при загрузке конвертировать в:

condition = {
    type: "margin",
    value: 2   // базовое значение бывшего крита
}

---

## ЧАСТЬ 10: Очистка

Удалить:

- CRIT_ATTACK из:
  - ability-sheet.js
  - item-sheet.js
  - templates

- UI элементы:
  - "КРИТ"
  - ×2

---

## ЧАСТЬ 11: Проверки

Проверить:

1. margin считается корректно
2. эффекты применяются при margin >= threshold
3. ничего не ломается без condition

---

## Ограничения

- НЕ переписывать всю боёвку
- НЕ менять систему бросков
- НЕ трогать DoT/HoT
- НЕ ломать существующие эффекты

---

## Результат

1. crit полностью удалён
2. введена универсальная система условий
3. эффекты используют margin >= X
4. логика централизована
5. UI обновлён