🧱 Этап 1 — Вынести модель эффекта
## Создать:

module/core/modifier-system.js
1.1 — Описать формат
export const ModifierSchema = {
  target: String,   // "armor", "attack", "hpMax"
  type: String,     // "flat", "mult", "override"
  value: Number,
  condition: Object // опционально
}
🧠 Этап 2 — Реестр эффектов (ключевая часть)
## Создать:

module/core/modifier-registry.js
2.1 — Реестр
export const ModifierRegistry = {

  armor: {
    stack: "add",
    default: 0
  },

  attack: {
    stack: "add",
    default: 0
  },

  hpMax: {
    stack: "add",
    default: 0
  },

  rollLuck: {
    stack: "add",
    default: 0
  }

}
💡 Зачем это нужно
## Теперь:

- ты знаешь ВСЕ возможные эффекты
- можно валидировать
- можно централизовать математику
⚙️ Этап 3 — Единая математика
## В modifier-system.js
3.1 — Агрегация
export function aggregateModifiers(modifiers) {
  const result = {}

  for (const mod of modifiers) {
    const def = ModifierRegistry[mod.target]
    if (!def) continue

    if (!(mod.target in result)) {
      result[mod.target] = def.default
    }

    switch (def.stack) {
      case "add":
        result[mod.target] += mod.value
        break

      case "mult":
        result[mod.target] *= mod.value
        break
    }
  }

  return result
}
🔁 Этап 4 — Унификация источников (самое важное)
## Цель:

ВСЕ сущности возвращают эффекты одинаково
4.1 — Создать helper
export function getModifiersFromEntity(entity) {
  return entity.system?.modifiers || []
}
4.2 — Привести ВСЕ к одному полю
## ЗАМЕНИТЬ:

system.effects → system.modifiers

В:

- item
- ability
- skill
- state

👉 Да, это миграция. Да, её надо сделать.

🧹 Этап 5 — Удалить дублирующуюся логику
## УДАЛИТЬ:

- normalizeEffects различия между типами
- локальные обработчики effects в sheet
🎨 Этап 6 — Один UI для всех
## Создать:

module/ui/modifier-editor.js
6.1 — Один редактор
Все листы (item, ability, skill, state):

НЕ рендерят effects сами

А вызывают:
openModifierEditor(entity)
6.2 — Удалить
- renderEffectRow из всех sheet
- updateEffects из всех sheet

🔗 Этап 7 — Интеграция в Effects (старый файл)
## В effects.js:

ЗАМЕНИТЬ:

collectEffectTotals

НА:

aggregateModifiers(allModifiers)
7.1 — Сбор всех модификаторов
export function collectAllModifiers(actor) {
  const sources = [
    ...actor.items,
    ...activeStates(actor)
  ]

  return sources.flatMap(getModifiersFromEntity)
}