## ЗАДАЧА

Реализовать stateful систему обработки атак в Vitruvium:

* startAttack (инициация)
* resumeAttack (продолжение после защиты)
* единый pipeline
* убрать прямые actor.update из UI

Дополнительно:
→ заложить поддержку типов урона (damage types, resistances, vulnerabilities)

---

## ЦЕЛЬ

1. Убрать разрыв pipeline (attack → defense → apply)
2. Сделать ActionProcessor центром логики
3. Перенести защиту внутрь процессора
4. Подготовить систему к damage types

---

## ЭТАП 1 — ACTION STORE

Создать:

module/core/action-store.js

---

### Реализация:

export const ActionStore = new Map()

---

### Формат хранения:

actionId → {
ctx,
createdAt,
userId
}

---

## ЭТАП 2 — РАСШИРИТЬ ActionContext

Файл: action-processor.js

---

Добавить:

ctx.id = randomID()
ctx.state = "pending_defense" | "resolved"

ctx.damage = {
base: number,
types: [
{ type: "physical", value: number }
]
}

---

## ЭТАП 3 — START ATTACK

Добавить метод:

ActionProcessor.startAttack(action)

---

### Логика:

1. создать ctx
2. stageRoll (атака)
3. stageModify
4. stageResolveAttackOnly (БЕЗ защиты)

---

### stageResolveAttackOnly:

* считать attackSuccesses
* НЕ считать финальный урон
* сформировать damage.base

---

### Вернуть:

{
actionId,
preview: {
attackRoll,
attackSuccesses,
damagePreview
}
}

---

### Сохранить:

ActionStore.set(actionId, ctx)

---

## ЭТАП 4 — RESUME ATTACK

Добавить:

ActionProcessor.resumeAttack(actionId, input)

---

### input:

{
defenseType: "block" | "dodge",
defender: Actor
}

---

### Логика:

1. достать ctx из ActionStore
2. stageDefense
3. stageResolveFinal
4. stageApply
5. удалить из ActionStore

---

## ЭТАП 5 — STAGE DEFENSE

Реализовать:

stageDefense(ctx, input)

---

### Делает:

* считает pool защиты
* вызывает DiceSystem.rollPool
* сохраняет:

ctx.rolls.defense
ctx.computed.defenseSuccesses

---

### ВАЖНО:

ВСЯ логика из combat.js:

* block
* dodge
* armor
  → перенести сюда

---

## ЭТАП 6 — STAGE RESOLVE FINAL

Реализовать:

stageResolveFinal(ctx)

---

### Делает:

1. вызывает DamageResolver
2. учитывает:

   * attackSuccesses
   * defenseSuccesses

---

### ДОБАВИТЬ DAMAGE TYPES

ctx.damage = {
parts: [
{ type: "physical", value: X }
]
}

---

## ЭТАП 7 — RESISTANCES / VULNERABILITIES

Добавить в ModifierSystem поддержку:

targets:

* resist.physical
* resist.fire
* vuln.physical
* vuln.fire

---

### В stageResolveFinal:

1. получить totals через ModifierSystem
2. применить:

finalDamage = damage * (1 - resist + vuln)

---

## ЭТАП 8 — STAGE APPLY

Реализовать:

stageApply(ctx)

---

### Делает:

1. суммирует damage.parts
2. применяет:

await actor.update({
"system.attributes.hp.value": newHp
}, {
vitruvium: {
damage: total,
types: ctx.damage.parts
}
})

---

### ВАЖНО:

ЭТО ЕДИНСТВЕННОЕ МЕСТО ГДЕ МЕНЯЕТСЯ HP

---

## ЭТАП 9 — ИНТЕГРАЦИЯ В COMBAT.JS

---

### ЗАМЕНИТЬ:

startWeaponAttackFlow

---

### Было:

* roll
* damage
* чат
* логика защиты

---

### Стало:

const { actionId, preview } = processor.startAttack(...)

renderChat(preview, actionId)

---

---

### В обработчике кнопки защиты:

const result = await processor.resumeAttack(actionId, {
defenseType,
defender
})

renderResult(result)

---

## ЭТАП 10 — УДАЛИТЬ BYPASS

Удалить ВСЕ:

actor.update({
"system.attributes.hp.value"
})

из:

* combat.js
* state-duration.js (HoT)

---

Заменить на:

ActionProcessor.process({
type: "apply_heal"
})

---

## ЭТАП 11 — СОКЕТЫ (если есть мультиплеер)

Если действие инициировано игроком:

* actionId должен быть доступен всем
* resume должен идти через socket

---

## ЭТАП 12 — ОЧИСТКА

Удалить:

* логику защиты из combat.js
* прямые вызовы DamageResolver вне процессора

---

## ОЖИДАЕМЫЙ РЕЗУЛЬТАТ

* единый pipeline
* ActionProcessor = центр логики
* защита встроена в систему
* нет прямых изменений HP вне ядра
* готовность к damage types

---

## ВАЖНО

НЕ:

* менять UI кардинально
* переписывать effects.js
* трогать sheets

---

## КРИТЕРИИ УСПЕХА

1. атака → защита → урон проходит через ActionProcessor
2. combat.js не считает урон
3. нет actor.update вне stageApply
4. damage types уже проходят через pipeline
д