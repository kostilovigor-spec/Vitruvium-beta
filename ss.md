## ЗАДАЧА

Реализовать:

1. Выбор типа урона в Item / Ability
2. Списки Resistances / Vulnerabilities в Actor sheet
3. Полную интеграцию с ActionProcessor (damage.parts)

---

## ЦЕЛЬ

* единая модель damage types
* корректная работа resist/vuln
* UI без дублирования логики

---

# ЭТАП 1 — ЕДИНЫЙ РЕЕСТР ТИПОВ УРОНА

Создать файл:

module/config/damage-types.js

---

### Реализация:
Физический
колющий (Piercing)
рубящий (Slashing)
дробящий (Bludgeoning)

Элементальный
холодом (Cold)
огненный (Fire)
молнией (Lightning)
ядовитый (Poison)

Магический
психический (Psychic)
мистический (Arcane)
святой (Radiant)
некротический (Necrotic)

Пример:
export const DAMAGE_TYPES = [
"Piercing",
"Fire",
"Cold",
"Poison",
"Arcane"
]

---

## ВАЖНО

НЕ хардкодить строки в UI или логике
ВСЁ брать из DAMAGE_TYPES

---

# ЭТАП 2 — РАСШИРИТЬ ДАННЫЕ ITEM / ABILITY

---

## Добавить поле:

system.damage = {
value: number,
type: "physical"
}

---

## ВАЖНО

НЕ хранить damage.parts в item

---

---

# ЭТАП 3 — UI ДЛЯ ВЫБОРА ТИПА УРОНА

---

## В item-sheet / ability-sheet:

Добавить:

* input для value
* select для type

---

### Пример:

<select name="system.damage.type">
  {{#each DAMAGE_TYPES}}
    <option value="{{this}}">{{this}}</option>
  {{/each}}
</select>

---

## Поведение:

* value → число
* type → один из DAMAGE_TYPES

---

---

# ЭТАП 4 — ИНТЕГРАЦИЯ В ACTION PROCESSOR

---

## В stageResolve (attack / ability):

ЗАМЕНИТЬ:

damage.base

---

НА:

ctx.damage.parts = [
{
type: action.payload.damage.type,
value: computedDamage
}
]

---

## ВАЖНО

ВСЕ действия (attack, ability, dot) используют parts

---

---

# ЭТАП 5 — RESIST / VULN В ACTOR

---

## Добавить:

system.resistances = []
system.vulnerabilities = []

---

## Формат:

["fire", "poison"]

---

---

# ЭТАП 6 — UI В CHARACTER SHEET

---

## Добавить 2 блока:

* Resistances
* Vulnerabilities

---

## Поведение:

* отображают список типов
* если пусто → ничего не показывают

---

---

## Кнопка "+" (ТОЛЬКО В РЕЖИМЕ EDIT)

---

### При клике:

открыть диалог:

DamageTypeSelector

---

---

## ЭТАП 7 — DAMAGE TYPE SELECTOR

---

Создать:

module/ui/damage-type-selector.js

---

### UI:

* список DAMAGE_TYPES
* чекбоксы
* кнопка "Применить"

---

### Возвращает:

["fire", "ice"]

---

---

## ЭТАП 8 — СОХРАНЕНИЕ

---

При подтверждении:

actor.update({
"system.resistances": selected
})

---

Аналогично для vulnerabilities

---

---

# ЭТАП 9 — ПРИМЕНЕНИЕ В STAGE APPLY

---

## В stageApply:

ЗАМЕНИТЬ:

_applyResistancesToParts

---

НА:

for (part of parts):

let value = part.value

if (actor.system.resistances.includes(part.type)):
value *= 0.5

if (actor.system.vulnerabilities.includes(part.type)):
value *= 2

---

---

# ЭТАП 10 — СИНХРОНИЗАЦИЯ С MODIFIER SYSTEM

---

## ВАЖНО

НЕ УДАЛЯТЬ:

resist.fire / vuln.fire modifiers

---

## Поведение:

* modifiers → динамика
* system.resistances → статический список

---

## В stageApply:

учитывать ОБА:

value *= (1 - modifierResist + modifierVuln)

---

---

# ЭТАП 11 — ОТОБРАЖЕНИЕ В UI

---

## В листе:

Resistances:

🔥 Fire
❄️ Ice

---

## Можно:

добавить иконки (опционально)

---

---

# ЭТАП 12 — ТЕСТЫ

---

Проверить:

1. оружие с fire уроном работает
2. ability с несколькими типами работает
3. resist уменьшает урон
4. vuln увеличивает
5. UI сохраняет значения

---

---

# КРИТИЧЕСКИЕ ОГРАНИЧЕНИЯ

---

НЕ:

* хранить damage.parts в item
* делать UI зависимым от ModifierSystem
* дублировать DAMAGE_TYPES

---

---

# ОЖИДАЕМЫЙ РЕЗУЛЬТАТ

* единый источник типов урона
* корректный UI
* pipeline не сломан
* готовность к сложным механикам
