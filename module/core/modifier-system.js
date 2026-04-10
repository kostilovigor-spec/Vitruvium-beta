import { ModifierRegistry } from "./modifier-registry.js";

const OVERTIME_TARGETS = new Set(["dot", "hot"]);
const OVERTIME_TIMINGS = new Set(["start", "end"]);

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const MODIFIER_CATEGORIES = {
  attributes: {
    label: "Атрибуты",
    items: [
      "condition", "attention", "movement", "combat", "thinking", "communication",
    ],
  },
  attribute_rolls: {
    label: "Броски атрибутов",
    items: [
      "conditionAdv", "conditionDis", "conditionLucky", "conditionUnlucky", "conditionDice",
      "attentionAdv", "attentionDis", "attentionLucky", "attentionUnlucky", "attentionDice",
      "movementAdv", "movementDis", "movementLucky", "movementUnlucky", "movementDice",
      "combatAdv", "combatDis", "combatLucky", "combatUnlucky", "combatDice",
      "thinkingAdv", "thinkingDis", "thinkingLucky", "thinkingUnlucky", "thinkingDice",
      "communicationAdv", "communicationDis", "communicationLucky", "communicationUnlucky", "communicationDice",
    ],
  },
  attack_rolls: {
    label: "Броски атаки",
    items: [
      "attackAdv", "attackDis", "attackLucky", "attackUnlucky", "attackDice",
      "weaponAdv", "weaponDis", "weaponLucky", "weaponUnlucky",
    ],
  },
  defense_rolls: {
    label: "Защитные броски",
    items: [
      "dodgeAdv", "dodgeDis", "dodgeLucky", "dodgeUnlucky", "dodgeDice",
      "blockAdv", "blockDis", "blockLucky", "blockUnlucky", "blockDice",
    ],
  },
  general_modifiers: {
    label: "Общие модификаторы",
    items: [
      "rollAdv", "rollDis", "rollLucky", "rollUnlucky",
      "rollDice", "rollFullAdv", "rollFullDis",
    ],
  },
  characteristics: {
    label: "Характеристики",
    items: [
      "hpMax", "inspMax", "speed",
    ],
  },
  protection: {
    label: "Защита",
    items: [
      "armorValue",
    ],
  },
  overtime: {
    label: "Эффекты со временем",
    items: [
      "dot", "hot",
    ],
  },
};

const MODIFIER_LABELS = {
  hpMax: "Макс. HP",
  rollAdv: "Все броски: преимущество",
  rollDis: "Все броски: помеха",
  rollLucky: "Все броски: удачливый",
  rollUnlucky: "Все броски: неудачливый",
  condition: "Самочувствие",
  attention: "Внимание",
  movement: "Движение",
  combat: "Сражение",
  thinking: "Мышление",
  communication: "Общение",
  conditionAdv: "Самочувствие: преимущество",
  conditionDis: "Самочувствие: помеха",
  conditionLucky: "Самочувствие: удачливый",
  conditionUnlucky: "Самочувствие: неудачливый",
  conditionDice: "Самочувствие: доп. кубы",
  attentionAdv: "Внимание: преимущество",
  attentionDis: "Внимание: помеха",
  attentionLucky: "Внимание: удачливый",
  attentionUnlucky: "Внимание: неудачливый",
  attentionDice: "Внимание: доп. кубы",
  movementAdv: "Движение: преимущество",
  movementDis: "Движение: помеха",
  movementLucky: "Движение: удачливый",
  movementUnlucky: "Движение: неудачливый",
  movementDice: "Движение: доп. кубы",
  combatAdv: "Сражение: преимущество",
  combatDis: "Сражение: помеха",
  combatLucky: "Сражение: удачливый",
  combatUnlucky: "Сражение: неудачливый",
  combatDice: "Сражение: доп. кубы",
  thinkingAdv: "Мышление: преимущество",
  thinkingDis: "Мышление: помеха",
  thinkingLucky: "Мышление: удачливый",
  thinkingUnlucky: "Мышление: неудачливый",
  thinkingDice: "Мышление: доп. кубы",
  communicationAdv: "Общение: преимущество",
  communicationDis: "Общение: помеха",
  communicationLucky: "Общение: удачливый",
  communicationUnlucky: "Общение: неудачливый",
  communicationDice: "Общение: доп. кубы",
  attackAdv: "Атака: преимущество",
  attackDis: "Атака: помеха",
  attackLucky: "Атака: удачливый",
  attackUnlucky: "Атака: неудачливый",
  attackDice: "Атака: доп. кубы",
  weaponAdv: "Атака оружием: преимущество",
  weaponDis: "Атака оружием: помеха",
  weaponLucky: "Атака оружием: удачливый",
  weaponUnlucky: "Атака оружием: неудачливый",
  dodgeAdv: "Уворот: преимущество",
  dodgeDis: "Уворот: помеха",
  dodgeLucky: "Уворот: удачливый",
  dodgeUnlucky: "Уворот: неудачливый",
  dodgeDice: "Уворот: доп. кубы",
  blockAdv: "Блок: преимущество",
  blockDis: "Блок: помеха",
  blockLucky: "Блок: удачливый",
  blockUnlucky: "Блок: неудачливый",
  blockDice: "Блок: доп. кубы",
  armorValue: "Броня",
  rollDice: "Все броски: доп. кубы",
  rollFullAdv: "Все броски: удачливый (полный переброс)",
  rollFullDis: "Все броски: неудачливый (полный переброс)",
  inspMax: "Макс. вдохновение",
  speed: "Скорость",
  dot: "Урон со временем",
  hot: "Лечение со временем",
};

const TYPE_LABELS = {
  flat: "Плоский",
  mult: "Множитель",
};

export const normalizeModifier = (modifier) => {
  if (!modifier || typeof modifier !== "object") return null;

  const target = String(
    modifier.target ?? modifier.key ?? modifier.effectKey ?? "",
  ).trim();
  if (!target) return null;

  let type = String(modifier.type ?? "flat").trim().toLowerCase();
  if (OVERTIME_TARGETS.has(target)) type = "flat";
  if (type !== "flat" && type !== "mult") type = "flat";

  const value = toNumber(modifier.value, 0);
  if (!Number.isFinite(value)) return null;

  const out = { target, type, value };
  if (OVERTIME_TARGETS.has(target)) {
    const triggerTiming = String(modifier.triggerTiming ?? "end").trim();
    out.triggerTiming = OVERTIME_TIMINGS.has(triggerTiming)
      ? triggerTiming
      : "end";
  }

  return out;
};

export const aggregateModifiers = (modifiers = []) => {
  const totals = {};
  for (const raw of modifiers) {
    const modifier = normalizeModifier(raw);
    if (!modifier) continue;

    const def = ModifierRegistry[modifier.target] ?? {
      stack: "add",
      default: 0,
    };

    if (!(modifier.target in totals)) {
      totals[modifier.target] = toNumber(def.default, 0);
    }

    if (def.stack === "mult" || modifier.type === "mult") {
      totals[modifier.target] *= modifier.value;
    } else {
      totals[modifier.target] += modifier.value;
    }
  }

  return totals;
};

export const getModifiersFromEntity = (entity) => {
  const raw = entity?.system?.modifiers;
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeModifier).filter(Boolean);
};

export const collectActorModifiers = (actor) => {
  const out = [];
  for (const item of actor?.items ?? []) {
    if (item.type === "item") {
      if (!item.system?.equipped) continue;
    } else if (item.type === "ability") {
      if (item.system?.active === false) continue;
    } else if (item.type === "state") {
      if (item.system?.active === false) continue;
    } else if (item.type !== "skill") {
      continue;
    }

    out.push(...getModifiersFromEntity(item));
  }
  return out;
};

export const computeActorTotals = (actor) => {
  const modifiers = collectActorModifiers(actor);
  return aggregateModifiers(modifiers);
};

export const getModifierLabel = (target) =>
  MODIFIER_LABELS[String(target ?? "").trim()] ?? String(target ?? "").trim();

export const presentModifiers = (modifiers = []) =>
  (Array.isArray(modifiers) ? modifiers : [])
    .map((m) => normalizeModifier(m))
    .filter(Boolean)
    .map((m) => ({
      target: m.target,
      targetLabel: getModifierLabel(m.target),
      type: m.type,
      typeLabel: TYPE_LABELS[m.type] ?? m.type,
      value: m.value,
      valueLabel:
        m.type === "mult" ? `x${m.value}` : m.value > 0 ? `+${m.value}` : `${m.value}`,
      triggerTiming: m.triggerTiming,
      triggerTimingLabel:
        m.triggerTiming === "start"
          ? "в начале хода"
          : m.triggerTiming === "end"
            ? "в конце хода"
            : "",
      isTimed: OVERTIME_TARGETS.has(m.target),
    }));

const renderModifierRow = (modifier = {}) => {
  const normalized = normalizeModifier(modifier) ?? {
    target: "rollAdv",
    type: "flat",
    value: 0,
  };

  const options = Object.entries(MODIFIER_CATEGORIES)
    .map(([, cat]) => {
      const opts = cat.items
        .map((key) => {
          const selected = key === normalized.target ? " selected" : "";
          return `<option value="${key}"${selected}>${getModifierLabel(key)}</option>`;
        })
        .join("");
      return `<optgroup label="${cat.label}">${opts}</optgroup>`;
    })
    .join("");

  const typeOptions = ["flat", "mult"]
    .map((kind) => {
      const selected = kind === normalized.type ? " selected" : "";
      return `<option value="${kind}"${selected}>${TYPE_LABELS[kind] ?? kind}</option>`;
    })
    .join("");

  const timingOptions = ["start", "end"]
    .map((timing) => {
      const selected = timing === normalized.triggerTiming ? " selected" : "";
      const label = timing === "start" ? "В начале хода" : "В конце хода";
      return `<option value="${timing}"${selected}>${label}</option>`;
    })
    .join("");

  const isTimed = OVERTIME_TARGETS.has(normalized.target);

  return `
    <div class="v-effects__row">
      <select class="v-effects__key">${options}</select>
      <select class="v-effects__type">${typeOptions}</select>
      <select class="v-effects__timing" ${isTimed ? "" : "style='display:none;'"}>${timingOptions}</select>
      <input type="number" class="v-effects__val" value="${normalized.value}" step="1" />
      <button type="button" class="v-mini v-effects__remove" title="Удалить">x</button>
    </div>
  `;
};

const syncTimedRow = ($row) => {
  const target = String($row.find(".v-effects__key").val() ?? "").trim();
  const isTimed = OVERTIME_TARGETS.has(target);
  const $timing = $row.find(".v-effects__timing");
  const $type = $row.find(".v-effects__type");
  const $value = $row.find(".v-effects__val");

  $timing.toggle(isTimed);
  if (isTimed) {
    $type.val("flat");
    const current = Math.round(Math.abs(toNumber($value.val(), 0)));
    $value.val(current);
  }
};

export const openModifierEditor = async (entity) => {
  const existing = getModifiersFromEntity(entity);
  const rowsHtml = existing.length
    ? existing.map((modifier) => renderModifierRow(modifier)).join("")
    : renderModifierRow();

  const dialog = new Dialog(
    {
      title: `Модификаторы: ${entity.name}`,
      content: `
        <form class="v-effects">
          <div class="v-effects__rows">${rowsHtml}</div>
          <div class="v-effects__footer">
            <button type="button" class="v-mini v-effects__add">+ Добавить</button>
          </div>
        </form>
      `,
      buttons: {
        save: {
          label: "Сохранить",
          callback: async (html) => {
            const next = [];
            html.find(".v-effects__row").each((_, row) => {
              const $row = $(row);
              const target = String($row.find(".v-effects__key").val() ?? "").trim();
              const type = String($row.find(".v-effects__type").val() ?? "flat").trim();
              const triggerTiming = String(
                $row.find(".v-effects__timing").val() ?? "end",
              ).trim();
              const value = toNumber($row.find(".v-effects__val").val(), 0);
              if (!target || !Number.isFinite(value)) return;

              if (OVERTIME_TARGETS.has(target)) {
                const timedValue = Math.max(0, Math.round(Math.abs(value)));
                if (timedValue <= 0) return;
                next.push({
                  target,
                  type: "flat",
                  triggerTiming: OVERTIME_TIMINGS.has(triggerTiming)
                    ? triggerTiming
                    : "end",
                  value: timedValue,
                });
                return;
              }

              if (value === 0) return;
              next.push({
                target,
                type: type === "mult" ? "mult" : "flat",
                value,
              });
            });

            await entity.update({ "system.modifiers": next });
          },
        },
        clear: {
          label: "Очистить",
          callback: async () => {
            await entity.update({ "system.modifiers": [] });
          },
        },
        cancel: { label: "Отмена" },
      },
      default: "save",
    },
    { width: 520 },
  );

  Hooks.once("renderDialog", (app, html) => {
    if (app !== dialog) return;

    html.on("click", ".v-effects__add", (ev) => {
      ev.preventDefault();
      const $rows = html.find(".v-effects__rows");
      $rows.append(renderModifierRow());
      syncTimedRow($rows.find(".v-effects__row").last());
    });

    html.on("click", ".v-effects__remove", (ev) => {
      ev.preventDefault();
      $(ev.currentTarget).closest(".v-effects__row").remove();
      if (!html.find(".v-effects__row").length) {
        const $rows = html.find(".v-effects__rows");
        $rows.append(renderModifierRow());
        syncTimedRow($rows.find(".v-effects__row").last());
      }
    });

    html.on("change", ".v-effects__key, .v-effects__val", (ev) => {
      const $row = $(ev.currentTarget).closest(".v-effects__row");
      syncTimedRow($row);
    });

    html.find(".v-effects__row").each((_, row) => {
      syncTimedRow($(row));
    });
  });

  dialog.render(true);
};
