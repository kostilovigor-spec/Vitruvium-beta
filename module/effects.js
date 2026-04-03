export const EFFECT_TARGETS = [
  // Атрибуты
  { key: "condition", label: "Самочувствие", group: "attributes" },
  { key: "attention", label: "Внимание", group: "attributes" },
  { key: "movement", label: "Движение", group: "attributes" },
  { key: "combat", label: "Сражение", group: "attributes" },
  { key: "thinking", label: "Мышление", group: "attributes" },
  { key: "communication", label: "Общение", group: "attributes" },

  // Броски атрибутов
  {
    key: "conditionRollLuck",
    label: "Самочувствие: преимущество/помеха",
    group: "attribute_rolls",
  },
  {
    key: "conditionRollDice",
    label: "Самочувствие: доп. кубы",
    group: "attribute_rolls",
  },
  {
    key: "attentionRollLuck",
    label: "Внимание: преимущество/помеха",
    group: "attribute_rolls",
  },
  {
    key: "attentionRollDice",
    label: "Внимание: доп. кубы",
    group: "attribute_rolls",
  },
  {
    key: "movementRollLuck",
    label: "Движение: преимущество/помеха",
    group: "attribute_rolls",
  },
  {
    key: "movementRollDice",
    label: "Движение: доп. кубы",
    group: "attribute_rolls",
  },
  {
    key: "combatRollLuck",
    label: "Сражение: преимущество/помеха",
    group: "attribute_rolls",
  },
  {
    key: "combatRollDice",
    label: "Сражение: доп. кубы",
    group: "attribute_rolls",
  },
  {
    key: "thinkingRollLuck",
    label: "Мышление: преимущество/помеха",
    group: "attribute_rolls",
  },
  {
    key: "thinkingRollDice",
    label: "Мышление: доп. кубы",
    group: "attribute_rolls",
  },
  {
    key: "communicationRollLuck",
    label: "Общение: преимущество/помеха",
    group: "attribute_rolls",
  },
  {
    key: "communicationRollDice",
    label: "Общение: доп. кубы",
    group: "attribute_rolls",
  },

  // Броски специальных действий
  {
    key: "attackRollLuck",
    label: "Атака: преимущество/помеха",
    group: "special_rolls",
  },
  { key: "attackRollDice", label: "Атака: доп. кубы", group: "special_rolls" },
  {
    key: "weaponLuck",
    label: "Атака оружием: преимущество/помеха",
    group: "special_rolls",
  },
  {
    key: "dodgeLuck",
    label: "Уворот: преимущество/помеха",
    group: "special_rolls",
  },
  { key: "dodgeDice", label: "Уворот: доп. кубы", group: "special_rolls" },
  {
    key: "blockLuck",
    label: "Блок: преимущество/помеха",
    group: "special_rolls",
  },
  { key: "blockDice", label: "Блок: доп. кубы", group: "special_rolls" },

  // Защита
  { key: "armorValue", label: "Броня: значение", group: "protection" },
  { key: "blockValue", label: "Блок: значение", group: "protection" },

  // Общие модификаторы
  {
    key: "rollLuck",
    label: "Все броски: преимущество/помеха",
    group: "general_modifiers",
  },
  {
    key: "rollDice",
    label: "Все броски: доп. кубы",
    group: "general_modifiers",
  },
  {
    key: "rollFullAdv",
    label: "Все броски: удачливый (полный переброс)",
    group: "general_modifiers",
  },
  {
    key: "rollFullDis",
    label: "Все броски: неудачливый (полный переброс)",
    group: "general_modifiers",
  },

  // Характеристики
  { key: "hpMax", label: "Макс. HP", group: "characteristics" },
  { key: "inspMax", label: "Макс. вдохновение", group: "characteristics" },
  { key: "speed", label: "Скорость", group: "characteristics" },
];

export const OVERTIME_EFFECT_TYPES = [
  { key: "dot", label: "Damage over Time" },
  { key: "hot", label: "Heal over Time" },
];

export const OVERTIME_TRIGGER_TIMINGS = [
  { key: "start", label: "Start of Turn" },
  { key: "end", label: "End of Turn" },
];

const LEGACY_EFFECT_KEY_MAP = {
  rollAdv: { key: "rollLuck", mul: 1 },
  rollDis: { key: "rollLuck", mul: -1 },
  weaponAdv: { key: "weaponLuck", mul: 1 },
  weaponDis: { key: "weaponLuck", mul: -1 },
  dodgeAdv: { key: "dodgeLuck", mul: 1 },
  dodgeDis: { key: "dodgeLuck", mul: -1 },
  blockAdv: { key: "blockLuck", mul: 1 },
  blockDis: { key: "blockLuck", mul: -1 },
  attackRollAdv: { key: "attackRollLuck", mul: 1 },
  attackRollDis: { key: "attackRollLuck", mul: -1 },
  conditionRollAdv: { key: "conditionRollLuck", mul: 1 },
  conditionRollDis: { key: "conditionRollLuck", mul: -1 },
  attentionRollAdv: { key: "attentionRollLuck", mul: 1 },
  attentionRollDis: { key: "attentionRollLuck", mul: -1 },
  movementRollAdv: { key: "movementRollLuck", mul: 1 },
  movementRollDis: { key: "movementRollLuck", mul: -1 },
  combatRollAdv: { key: "combatRollLuck", mul: 1 },
  combatRollDis: { key: "combatRollLuck", mul: -1 },
  thinkingRollAdv: { key: "thinkingRollLuck", mul: 1 },
  thinkingRollDis: { key: "thinkingRollLuck", mul: -1 },
  communicationRollAdv: { key: "communicationRollLuck", mul: 1 },
  communicationRollDis: { key: "communicationRollLuck", mul: -1 },
};

const EFFECT_KEYS = new Set(EFFECT_TARGETS.map((t) => t.key));
const OVERTIME_TYPE_KEYS = new Set(OVERTIME_EFFECT_TYPES.map((t) => t.key));
const OVERTIME_TIMING_KEYS = new Set(
  OVERTIME_TRIGGER_TIMINGS.map((t) => t.key),
);
const ROLL_ATTRIBUTE_KEYS = [
  "condition",
  "attention",
  "movement",
  "combat",
  "thinking",
  "communication",
];

const clampValue = (n, min, max) => Math.min(Math.max(n, min), max);
const numValue = (v, d) => {
  if (v !== null && typeof v === "object" && "value" in v) {
    const x = Number(v.value);
    return Number.isNaN(x) ? d : x;
  }
  const x = Number(v);
  return Number.isNaN(x) ? d : x;
};

const toRollAttributeKey = (attrKey) => {
  const key = String(attrKey ?? "").trim();
  return ROLL_ATTRIBUTE_KEYS.includes(key) ? key : null;
};

const splitLuck = (value) => {
  const v = numValue(value, 0);
  if (v > 0) return { adv: v, dis: 0 };
  if (v < 0) return { adv: 0, dis: Math.abs(v) };
  return { adv: 0, dis: 0 };
};

export const normalizeEffects = (raw, { keepZero = false } = {}) => {
  const entries = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.entries(raw).map(([key, value]) => ({ key, value }))
      : [];
  if (!entries.length) return [];
  const byKey = new Map();
  const overTime = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;

    let key = String(entry.key ?? entry.effectKey ?? entry.target ?? "").trim();
    let overType = String(entry.type ?? entry.effectType ?? "").trim();
    if (!overType && OVERTIME_TYPE_KEYS.has(key)) {
      overType = key;
      key = "";
    }
    if (OVERTIME_TYPE_KEYS.has(overType)) {
      const timingRaw = String(entry.triggerTiming ?? "").trim();
      const triggerTiming = OVERTIME_TIMING_KEYS.has(timingRaw)
        ? timingRaw
        : "end";
      const value = Math.abs(numValue(entry.value, 0));
      if (!Number.isFinite(value)) continue;
      if (!keepZero && value === 0) continue;
      overTime.push({ type: overType, triggerTiming, value });
      continue;
    }

    let value = numValue(entry.value, 0);
    if (!Number.isFinite(value)) continue;

    const legacyMap = LEGACY_EFFECT_KEY_MAP[key];
    if (legacyMap) {
      key = legacyMap.key;
      value *= legacyMap.mul;
    }

    if (!EFFECT_KEYS.has(key)) continue;
    byKey.set(key, numValue(byKey.get(key), 0) + value);
  }

  const out = [];
  for (const target of EFFECT_TARGETS) {
    const value = byKey.get(target.key);
    if (!Number.isFinite(value)) continue;
    if (!keepZero && value === 0) continue;
    out.push({ key: target.key, value });
  }
  return [...out, ...overTime];
};

export const collectEffectTotals = (actor) => {
  const totals = {};
  const items = actor?.items ?? [];

  const add = (key, value) => {
    if (!Number.isFinite(value) || value === 0) return;
    totals[key] = (totals[key] ?? 0) + value;
  };

  for (const item of items) {
    if (item.type === "item") {
      if (!item.system?.equipped) continue;
    } else if (item.type === "ability") {
      if (item.system?.active === false) continue;
    } else if (item.type === "state") {
      if (item.system?.active === false) continue;
    } else if (item.type !== "skill") {
      continue;
    }

    const effects = normalizeEffects(item.system?.effects);
    for (const eff of effects) {
      if (!eff?.key) continue;
      add(eff.key, eff.value);
    }
  }

  return totals;
};

export const getEffectValue = (totals, key) => {
  const v = numValue(totals?.[key], 0);
  return Number.isFinite(v) ? v : 0;
};

export const getLuckModifiers = (
  totals,
  { signedKey = null, advKey = null, disKey = null } = {},
) => {
  const signed = splitLuck(signedKey ? getEffectValue(totals, signedKey) : 0);
  const legacyAdv = advKey ? Math.max(0, getEffectValue(totals, advKey)) : 0;
  const legacyDis = disKey ? Math.max(0, getEffectValue(totals, disKey)) : 0;
  return { adv: signed.adv + legacyAdv, dis: signed.dis + legacyDis };
};

export const getEffectiveAttribute = (attrs, key, totals) => {
  const base = clampValue(numValue(attrs?.[key], 1), 1, 6);
  const total = base + getEffectValue(totals, key);
  return clampValue(total, 1, 6);
};

export const getGlobalRollModifiers = (totals) => {
  const luck = getLuckModifiers(totals, {
    signedKey: "rollLuck",
    advKey: "rollAdv",
    disKey: "rollDis",
  });
  const fullAdv = Math.max(0, getEffectValue(totals, "rollFullAdv"));
  const fullDis = Math.max(0, getEffectValue(totals, "rollFullDis"));
  let fullMode = "normal";
  if (fullAdv > fullDis) fullMode = "adv";
  else if (fullDis > fullAdv) fullMode = "dis";
  return {
    adv: luck.adv,
    dis: luck.dis,
    fullMode,
    dice: getEffectValue(totals, "rollDice"),
  };
};

export const getAttributeRollModifiers = (totals, attrKey) => {
  const key = toRollAttributeKey(attrKey);
  if (!key) return { adv: 0, dis: 0, dice: 0 };
  const luck = getLuckModifiers(totals, {
    signedKey: `${key}RollLuck`,
    advKey: `${key}RollAdv`,
    disKey: `${key}RollDis`,
  });
  return {
    adv: luck.adv,
    dis: luck.dis,
    dice: getEffectValue(totals, `${key}RollDice`),
  };
};

export const getAttackRollModifiers = (totals, { attrKey = null } = {}) => {
  const attrMods = getAttributeRollModifiers(totals, attrKey);
  const attackLuck = getLuckModifiers(totals, {
    signedKey: "attackRollLuck",
    advKey: "attackRollAdv",
    disKey: "attackRollDis",
  });
  return {
    adv: attrMods.adv + attackLuck.adv,
    dis: attrMods.dis + attackLuck.dis,
    dice: attrMods.dice + getEffectValue(totals, "attackRollDice"),
  };
};

const renderEffectRow = (effect = {}) => {
  const typeKey = String(effect.type ?? "").trim();
  const isOverTime = OVERTIME_TYPE_KEYS.has(typeKey);
  const key = isOverTime
    ? typeKey
    : EFFECT_TARGETS.find((t) => t.key === effect.key)?.key ??
      EFFECT_TARGETS[0].key;
  const rawValue = Number.isFinite(effect.value) ? Number(effect.value) : 0;
  const value = isOverTime
    ? Math.max(0, Math.round(Math.abs(rawValue)))
    : rawValue;
  const triggerTimingRaw = String(effect.triggerTiming ?? "").trim();
  const triggerTiming = OVERTIME_TIMING_KEYS.has(triggerTimingRaw)
    ? triggerTimingRaw
    : "end";

  // Группируем эффекты по категориям
  const groupedOptions = {};
  for (const opt of EFFECT_TARGETS) {
    const group = opt.group || "other";
    if (!groupedOptions[group]) {
      groupedOptions[group] = [];
    }
    groupedOptions[group].push(opt);
  }

  // Создаем опции с группировкой
  let options = "";
  for (const [groupName, groupItems] of Object.entries(groupedOptions)) {
    if (groupItems.length > 0) {
      options += `<optgroup label="${groupName}">`;
      for (const opt of groupItems) {
        const selected = opt.key === key ? " selected" : "";
        options += `<option value="${opt.key}"${selected}>${opt.label}</option>`;
      }
      options += `</optgroup>`;
    }
  }

  options += `<optgroup label="over_time">`;
  for (const opt of OVERTIME_EFFECT_TYPES) {
    const selected = opt.key === key ? " selected" : "";
    options += `<option value="${opt.key}"${selected}>${opt.label}</option>`;
  }
  options += `</optgroup>`;

  const timingOptions = OVERTIME_TRIGGER_TIMINGS.map((opt) => {
    const selected = opt.key === triggerTiming ? " selected" : "";
    return `<option value="${opt.key}"${selected}>${opt.label}</option>`;
  }).join("");

  return `
    <div class="v-effects__row">
      <select class="v-effects__key">${options}</select>
      <select class="v-effects__timing" ${
        isOverTime ? "" : "style='display:none;'"
      }>${timingOptions}</select>
      <input type="number" class="v-effects__val" value="${value}" step="1" />
      <button type="button" class="v-mini v-effects__remove" title="Удалить">x</button>
    </div>
  `;
};

export const openEffectsDialog = async (item) => {
  const effects = normalizeEffects(item.system?.effects, { keepZero: true });
  const rowsHtml = effects.length
    ? effects.map(renderEffectRow).join("")
    : renderEffectRow();
  const hint =
    item.type === "item"
      ? `<div class="v-subtle">Работает, пока предмет надет.</div>`
      : item.type === "ability"
        ? `<div class="v-subtle">Работает, пока способность активна.</div>`
        : `<div class="v-subtle">Работает всегда.</div>`;
  const content = `
    <form class="v-effects">
      <div class="v-effects__rows">${rowsHtml}</div>
      <div class="v-effects__footer">
        <button type="button" class="v-mini v-effects__add">+ Добавить</button>
      </div>
      ${hint}
    </form>
  `;

  const dialog = new Dialog(
    {
      title: `Эффекты: ${item.name}`,
      content,
      buttons: {
        save: {
          label: "Сохранить",
          callback: async (html) => {
            const next = [];
            html.find(".v-effects__row").each((_, row) => {
              const $row = $(row);
              const key = String($row.find(".v-effects__key").val() ?? "");
              const value = numValue($row.find(".v-effects__val").val(), 0);
              if (OVERTIME_TYPE_KEYS.has(key)) {
                const triggerTimingRaw = String(
                  $row.find(".v-effects__timing").val() ?? "end",
                ).trim();
                const triggerTiming = OVERTIME_TIMING_KEYS.has(triggerTimingRaw)
                  ? triggerTimingRaw
                  : "end";
                const timedVal = Math.max(
                  0,
                  Math.round(Math.abs(numValue(value, 0))),
                );
                if (!Number.isFinite(timedVal) || timedVal <= 0) return;
                next.push({ type: key, triggerTiming, value: timedVal });
                return;
              }
              if (!EFFECT_KEYS.has(key)) return;
              if (!Number.isFinite(value) || value === 0) return;
              next.push({ key, value });
            });
            await item.update({ "system.effects": next });
          },
        },
        clear: {
          label: "Очистить",
          callback: async () => {
            await item.update({ "system.effects": [] });
          },
        },
        cancel: { label: "Отмена" },
      },
      default: "save",
    },
    { width: 420 },
  );

  Hooks.once("renderDialog", (app, html) => {
    if (app !== dialog) return;
    const syncTimedRows = (root) => {
      root.find(".v-effects__row").each((_, row) => {
        const $row = $(row);
        const key = String($row.find(".v-effects__key").val() ?? "");
        const isTimed = OVERTIME_TYPE_KEYS.has(key);
        const $timing = $row.find(".v-effects__timing");
        const $value = $row.find(".v-effects__val");
        $timing.toggle(isTimed);
        if (isTimed) {
          const cur = numValue($value.val(), 0);
          $value.val(Math.max(0, Math.round(Math.abs(cur))));
        }
      });
    };
    html.on("click", ".v-effects__add", (ev) => {
      ev.preventDefault();
      html.find(".v-effects__rows").append(renderEffectRow());
      syncTimedRows(html);
    });
    html.on("click", ".v-effects__remove", (ev) => {
      ev.preventDefault();
      $(ev.currentTarget).closest(".v-effects__row").remove();
      if (!html.find(".v-effects__row").length) {
        html.find(".v-effects__rows").append(renderEffectRow());
      }
      syncTimedRows(html);
    });
    html.on("change", ".v-effects__key", () => {
      syncTimedRows(html);
    });
    html.on("change", ".v-effects__val", (ev) => {
      const $row = $(ev.currentTarget).closest(".v-effects__row");
      const key = String($row.find(".v-effects__key").val() ?? "");
      if (!OVERTIME_TYPE_KEYS.has(key)) return;
      const val = numValue($(ev.currentTarget).val(), 0);
      $(ev.currentTarget).val(Math.max(0, Math.round(Math.abs(val))));
    });
    syncTimedRows(html);
  });

  dialog.render(true);
};
