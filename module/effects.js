import {
  computeActorTotals,
  openModifierEditor,
} from "./core/modifier-system.js";

export const EFFECT_TARGETS = [
  { key: "condition", label: "Самочувствие", group: "attributes" },
  { key: "attention", label: "Внимание", group: "attributes" },
  { key: "movement", label: "Движение", group: "attributes" },
  { key: "combat", label: "Сражение", group: "attributes" },
  { key: "thinking", label: "Мышление", group: "attributes" },
  { key: "communication", label: "Общение", group: "attributes" },
  {
    key: "conditionAdv",
    label: "Самочувствие: преимущество",
    group: "attribute_rolls",
  },
  {
    key: "conditionDis",
    label: "Самочувствие: помеха",
    group: "attribute_rolls",
  },
  {
    key: "conditionLucky",
    label: "Самочувствие: удачливый",
    group: "attribute_rolls",
  },
  {
    key: "conditionUnlucky",
    label: "Самочувствие: неудачливый",
    group: "attribute_rolls",
  },
  {
    key: "conditionDice",
    label: "Самочувствие: доп. кубы",
    group: "attribute_rolls",
  },
  {
    key: "attentionAdv",
    label: "Внимание: преимущество",
    group: "attribute_rolls",
  },
  {
    key: "attentionDis",
    label: "Внимание: помеха",
    group: "attribute_rolls",
  },
  {
    key: "attentionLucky",
    label: "Внимание: удачливый",
    group: "attribute_rolls",
  },
  {
    key: "attentionUnlucky",
    label: "Внимание: неудачливый",
    group: "attribute_rolls",
  },
  {
    key: "attentionDice",
    label: "Внимание: доп. кубы",
    group: "attribute_rolls",
  },
  {
    key: "movementAdv",
    label: "Движение: преимущество",
    group: "attribute_rolls",
  },
  {
    key: "movementDis",
    label: "Движение: помеха",
    group: "attribute_rolls",
  },
  {
    key: "movementLucky",
    label: "Движение: удачливый",
    group: "attribute_rolls",
  },
  {
    key: "movementUnlucky",
    label: "Движение: неудачливый",
    group: "attribute_rolls",
  },
  {
    key: "movementDice",
    label: "Движение: доп. кубы",
    group: "attribute_rolls",
  },
  {
    key: "combatAdv",
    label: "Сражение: преимущество",
    group: "attribute_rolls",
  },
  {
    key: "combatDis",
    label: "Сражение: помеха",
    group: "attribute_rolls",
  },
  {
    key: "combatLucky",
    label: "Сражение: удачливый",
    group: "attribute_rolls",
  },
  {
    key: "combatUnlucky",
    label: "Сражение: неудачливый",
    group: "attribute_rolls",
  },
  {
    key: "combatDice",
    label: "Сражение: доп. кубы",
    group: "attribute_rolls",
  },
  {
    key: "thinkingAdv",
    label: "Мышление: преимущество",
    group: "attribute_rolls",
  },
  {
    key: "thinkingDis",
    label: "Мышление: помеха",
    group: "attribute_rolls",
  },
  {
    key: "thinkingLucky",
    label: "Мышление: удачливый",
    group: "attribute_rolls",
  },
  {
    key: "thinkingUnlucky",
    label: "Мышление: неудачливый",
    group: "attribute_rolls",
  },
  {
    key: "thinkingDice",
    label: "Мышление: доп. кубы",
    group: "attribute_rolls",
  },
  {
    key: "communicationAdv",
    label: "Общение: преимущество",
    group: "attribute_rolls",
  },
  {
    key: "communicationDis",
    label: "Общение: помеха",
    group: "attribute_rolls",
  },
  {
    key: "communicationLucky",
    label: "Общение: удачливый",
    group: "attribute_rolls",
  },
  {
    key: "communicationUnlucky",
    label: "Общение: неудачливый",
    group: "attribute_rolls",
  },
  {
    key: "communicationDice",
    label: "Общение: доп. кубы",
    group: "attribute_rolls",
  },
  {
    key: "attackAdv",
    label: "Атака: преимущество",
    group: "special_rolls",
  },
  {
    key: "attackDis",
    label: "Атака: помеха",
    group: "special_rolls",
  },
  {
    key: "attackLucky",
    label: "Атака: удачливый",
    group: "special_rolls",
  },
  {
    key: "attackUnlucky",
    label: "Атака: неудачливый",
    group: "special_rolls",
  },
  {
    key: "attackDice",
    label: "Атака: доп. кубы",
    group: "special_rolls",
  },
  {
    key: "weaponAdv",
    label: "Атака оружием: преимущество",
    group: "special_rolls",
  },
  {
    key: "weaponDis",
    label: "Атака оружием: помеха",
    group: "special_rolls",
  },
  {
    key: "weaponLucky",
    label: "Атака оружием: удачливый",
    group: "special_rolls",
  },
  {
    key: "weaponUnlucky",
    label: "Атака оружием: неудачливый",
    group: "special_rolls",
  },
  {
    key: "dodgeAdv",
    label: "Уворот: преимущество",
    group: "special_rolls",
  },
  {
    key: "dodgeDis",
    label: "Уворот: помеха",
    group: "special_rolls",
  },
  {
    key: "dodgeLucky",
    label: "Уворот: удачливый",
    group: "special_rolls",
  },
  {
    key: "dodgeUnlucky",
    label: "Уворот: неудачливый",
    group: "special_rolls",
  },
  {
    key: "dodgeDice",
    label: "Уворот: доп. кубы",
    group: "special_rolls",
  },
  {
    key: "blockAdv",
    label: "Блок: преимущество",
    group: "special_rolls",
  },
  {
    key: "blockDis",
    label: "Блок: помеха",
    group: "special_rolls",
  },
  {
    key: "blockLucky",
    label: "Блок: удачливый",
    group: "special_rolls",
  },
  {
    key: "blockUnlucky",
    label: "Блок: неудачливый",
    group: "special_rolls",
  },
  {
    key: "blockDice",
    label: "Блок: доп. кубы",
    group: "special_rolls",
  },
  { key: "armorValue", label: "Броня", group: "protection" },
  {
    key: "rollAdv",
    label: "Все броски: преимущество",
    group: "general_modifiers",
  },
  {
    key: "rollDis",
    label: "Все броски: помеха",
    group: "general_modifiers",
  },
  {
    key: "rollLucky",
    label: "Все броски: удачливый",
    group: "general_modifiers",
  },
  {
    key: "rollUnlucky",
    label: "Все броски: неудачливый",
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

const EFFECT_KEYS = new Set(EFFECT_TARGETS.map((t) => t.key));
const OVERTIME_TYPE_KEYS = new Set(OVERTIME_EFFECT_TYPES.map((t) => t.key));
const OVERTIME_TIMING_KEYS = new Set(OVERTIME_TRIGGER_TIMINGS.map((t) => t.key));

const clampValue = (n, min, max) => Math.min(Math.max(n, min), max);
const numValue = (v, d) => {
  if (v !== null && typeof v === "object" && "value" in v) {
    const x = Number(v.value);
    return Number.isNaN(x) ? d : x;
  }
  const x = Number(v);
  return Number.isNaN(x) ? d : x;
};

const ROLL_ATTRIBUTE_KEYS = [
  "condition",
  "attention",
  "movement",
  "combat",
  "thinking",
  "communication",
];

const toRollAttributeKey = (attrKey) => {
  const key = String(attrKey ?? "").trim();
  return ROLL_ATTRIBUTE_KEYS.includes(key) ? key : null;
};

export const normalizeModifiers = (raw, { keepZero = false } = {}) => {
  const entries = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.entries(raw).map(([target, value]) => ({ target, value }))
      : [];

  if (!entries.length) return [];

  const byKey = new Map();
  const overTime = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;

    const target = String(entry.target ?? "").trim();
    if (!target) continue;

    if (OVERTIME_TYPE_KEYS.has(target)) {
      const timingRaw = String(entry.triggerTiming ?? "end").trim();
      const triggerTiming = OVERTIME_TIMING_KEYS.has(timingRaw)
        ? timingRaw
        : "end";
      const value = Math.abs(numValue(entry.value, 0));
      if (!Number.isFinite(value)) continue;
      if (!keepZero && value === 0) continue;
      overTime.push({ target, type: "flat", triggerTiming, value });
      continue;
    }

    if (!EFFECT_KEYS.has(target)) continue;
    const value = numValue(entry.value, 0);
    if (!Number.isFinite(value)) continue;
    byKey.set(target, numValue(byKey.get(target), 0) + value);
  }

  const out = [];
  for (const target of EFFECT_TARGETS) {
    const value = byKey.get(target.key);
    if (!Number.isFinite(value)) continue;
    if (!keepZero && value === 0) continue;
    out.push({ target: target.key, type: "flat", value });
  }

  return [...out, ...overTime];
};

export const collectEffectTotals = (actor) => computeActorTotals(actor);

export const getEffectValue = (totals, key) => {
  const v = numValue(totals?.[key], 0);
  return Number.isFinite(v) ? v : 0;
};

export const getLuckModifiers = (
  totals,
  { advKey = null, disKey = null, luckyKey = null, unluckyKey = null } = {},
) => {
  const adv = advKey ? getEffectValue(totals, advKey) : 0;
  const dis = disKey ? getEffectValue(totals, disKey) : 0;
  const lucky = luckyKey ? getEffectValue(totals, luckyKey) : 0;
  const unlucky = unluckyKey ? getEffectValue(totals, unluckyKey) : 0;
  return { adv, dis, lucky, unlucky };
};

export const getEffectiveAttribute = (attrs, key, totals) => {
  const base = clampValue(numValue(attrs?.[key], 1), 1, 6);
  const total = base + getEffectValue(totals, key);
  return clampValue(total, 1, 6);
};

export const getGlobalRollModifiers = (totals) => {
  const luck = getLuckModifiers(totals, {
    advKey: "rollAdv",
    disKey: "rollDis",
    luckyKey: "rollLucky",
    unluckyKey: "rollUnlucky",
  });
  const fullAdv = Math.max(0, getEffectValue(totals, "rollFullAdv"));
  const fullDis = Math.max(0, getEffectValue(totals, "rollFullDis"));
  let fullMode = "normal";
  if (fullAdv > fullDis) fullMode = "adv";
  else if (fullDis > fullAdv) fullMode = "dis";
  return {
    adv: luck.adv,
    dis: luck.dis,
    lucky: luck.lucky,
    unlucky: luck.unlucky,
    fullMode,
    dice: getEffectValue(totals, "rollDice"),
  };
};

export const getAttributeRollModifiers = (totals, attrKey) => {
  const key = toRollAttributeKey(attrKey);
  if (!key) return { adv: 0, dis: 0, lucky: 0, unlucky: 0, dice: 0 };
  const luck = getLuckModifiers(totals, {
    advKey: `${key}Adv`,
    disKey: `${key}Dis`,
    luckyKey: `${key}Lucky`,
    unluckyKey: `${key}Unlucky`,
  });
  return {
    adv: luck.adv,
    dis: luck.dis,
    lucky: luck.lucky,
    unlucky: luck.unlucky,
    dice: getEffectValue(totals, `${key}Dice`),
  };
};

export const getAttackRollModifiers = (totals, { attrKey = null } = {}) => {
  const attrMods = getAttributeRollModifiers(totals, attrKey);
  const attackLuck = getLuckModifiers(totals, {
    advKey: "attackAdv",
    disKey: "attackDis",
    luckyKey: "attackLucky",
    unluckyKey: "attackUnlucky",
  });
  return {
    adv: attrMods.adv + attackLuck.adv,
    dis: attrMods.dis + attackLuck.dis,
    lucky: attrMods.lucky + attackLuck.lucky,
    unlucky: attrMods.unlucky + attackLuck.unlucky,
    dice: attrMods.dice + getEffectValue(totals, "attackDice"),
  };
};

export { openModifierEditor };

export async function applyEffect(actor, effectData) {
  if (!actor) return;
  return await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
}

export async function removeEffect(actor, originUuid) {
  if (!actor) return;
  const effectsToRemove =
    actor.effects?.filter((ef) => ef.origin && ef.origin.includes(originUuid)) || [];
  if (effectsToRemove.length > 0) {
    return await actor.deleteEmbeddedDocuments(
      "ActiveEffect",
      effectsToRemove.map((ef) => ef.id),
    );
  }
}
