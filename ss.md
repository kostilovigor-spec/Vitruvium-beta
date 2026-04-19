## ЗАДАЧА

Обобщить текущую stateful систему действий, чтобы она поддерживала:

* attack
* ability
* heal
* dot

через единый pipeline ActionProcessor

---

## ЦЕЛЬ

1. Убрать fallback-ветки в combat.js
2. Сделать process() универсальной точкой входа
3. Перевести ability на тот же pipeline
4. Сохранить start/resume механику

---

## ЭТАП 1 — УНИФИКАЦИЯ API

Файл: action-processor.js

---

### Добавить:

process(action, input?)

---

### Поведение:

* если action.state отсутствует → init
* если state = await_input → resume
* иначе → продолжить pipeline

---

---

## ЭТАП 2 — ЕДИНЫЙ ФОРМАТ ACTION

```javascript
{
  id,
  type: "attack" | "ability" | "heal" | "dot",
  state: "init" | "await_input" | "resolved",
  payload: {}
}
```

---

## ЭТАП 3 — ПЕРЕПИСАТЬ startAttack / resumeAttack

---

### Было:

startAttack()
resumeAttack()

---

### Стало:

process(action)

---

### НО:

оставить startAttack как thin wrapper:

```javascript
startAttack(action) {
  return this.process({ ...action, type: "attack", state: "init" })
}
```

---

## ЭТАП 4 — PIPELINE ПО ТИПАМ

Внутри process():

switch(action.type)

---

### attack

* init:

  * roll attack
  * state → await_input
  * сохранить в ActionStore
  * return preview

* await_input:

  * defense
  * resolve
  * apply
  * удалить из store

---

### ability

---

#### вариант 1 (без защиты):

* init:

  * roll (если есть)
  * resolve
  * apply
  * state → resolved

---

#### вариант 2 (если требует contest):

* init:

  * roll атаки
  * state → await_input

* await_input:

  * contest / defense
  * resolve
  * apply

---

---

### heal

* init:

  * сразу stageApply
  * state → resolved

---

---

### dot

* init:

  * tick damage
  * stageApply
  * state → resolved

---

## ЭТАП 5 — УДАЛИТЬ FALLBACK В COMBAT.JS

---

### НАЙТИ:

fallback ветку:

"если нет actionId"

---

### ЗАМЕНИТЬ:

всегда создавать action:

type: "ability"

---

---

## ЭТАП 6 — ПЕРЕПИСАТЬ ABILITY FLOW

---

### Сейчас:

ability считается напрямую

---

### Нужно:

```javascript
processor.process({
  type: "ability",
  payload: { ... }
})
```

---

---

## ЭТАП 7 — DAMAGE TYPES (УСИЛЕНИЕ)

---

### ДОБАВИТЬ:

damage.parts может содержать несколько типов:

```javascript
[
  { type: "physical", value: 10 },
  { type: "fire", value: 5 }
]
```

---

### В stageResolve:

ability тоже использует damage.parts

---

---

## ЭТАП 8 — RESISTANCES ПРИМЕНЯЮТСЯ КО ВСЕМ ТИПАМ

---

### В stageApply:

перебрать:

damage.parts

---

для каждого:

* применить resist.*
* применить vuln.*

---

---

## ЭТАП 9 — УДАЛИТЬ СТАРЫЕ ВХОДЫ

Удалить:

* processAttack (старый)
* любые прямые ability-расчёты вне процессора

---

---

## ЭТАП 10 — ТЕСТЫ

Проверить:

1. attack работает как раньше
2. ability работает через pipeline
3. heal НЕ использует actor.update напрямую
4. dot работает через pipeline
5. нет fallback логики

---

## ОЖИДАЕМЫЙ РЕЗУЛЬТАТ

* один ActionProcessor.process()
* нет разделения attack / ability
* pipeline единый
* damage types применяются везде

---

## КРИТЕРИИ УСПЕХА

1. combat.js НЕ содержит логики урона
2. нет fallback веток
3. все действия идут через process()
4. ActionStore используется для всех async действий
