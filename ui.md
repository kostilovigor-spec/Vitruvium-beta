Шаг 1 — Исправление getData (КЛЮЧЕВОЕ)
## В getData: нормализуй и отсортируй

1. Собери предметы
2. Сгруппируй по типу
3. Прогони через INVENTORY_ORDER

---

Пример:

const grouped = {
  weapon: [],
  equipment: [],
  consumable: [],
  tool: [],
  trinket: [],
  loot: []
};

for (const item of items) {
  const type = item.system?.category || item.type;
  if (grouped[type]) grouped[type].push(item);
}

const inventory = INVENTORY_ORDER.map(type => ({
  type,
  label: INVENTORY_LABELS[type],
  items: grouped[type] || []
}));

return { inventory };

Важно:
даже если пусто → категория должна быть


👉 Это убивает проблему навсегда.

---

# 🔹 Шаг 2 — UI кнопка "+" (контекстная)

```markdown id="step-2-plus"
## Добавь кнопку "+" в header каждой категории

В шаблоне:

<div class="v-inventory-header" data-type="{{type}}">
  <span>{{label}}</span>
  <button class="v-add-item" data-type="{{type}}">+</button>
</div>
🔹 Шаг 3 — Обработчик создания
## В activateListeners

html.find(".v-add-item").click(ev => {
  const type = ev.currentTarget.dataset.type;

  this._createItemFromCategory(type);
});
🔹 Шаг 4 — Функция создания
## Создание предмета с категорией

async _createItemFromCategory(type) {
  const itemData = {
    name: "Новый предмет",
    type: "item",
    system: {
      category: type
    }
  };

  return this.actor.createEmbeddedDocuments("Item", [itemData]);
}
🧠 Важный момент (иначе словишь баг)
## Откуда брать category

Проблема:

- item.type ≠ category

---

Правильно:

использовать:
system.category

---

Если нет:
сделать fallback:

const type = item.system?.category ?? item.type;
🔹 Шаг 5 — Для способностей (аналогично)
## Для abilities

Кнопка:

data-type="ability"

---

Создание:

{
  name: "Новая способность",
  type: "ability",
  system: {
    category: "primary" // или нужная
  }
}


Исправь систему инвентаря в листе персонажа.

Требования:

1. Ввести фиксированный порядок категорий:
   weapon → equipment → consumable → tool → trinket → loot

2. В getData:
   - сгруппировать предметы по system.category
   - сформировать массив категорий строго по порядку
   - включать даже пустые категории

3. В UI:
   - каждая категория имеет header
   - справа кнопка "+"

4. Кнопка "+":
   - создаёт новый Item
   - автоматически задаёт system.category

5. НЕ изменять:
   - существующую логику предметов
   - data paths
   - обработку эффектов

6. Проверить:
   - порядок категорий стабилен
   - создание работает корректно
   - данные сохраняются