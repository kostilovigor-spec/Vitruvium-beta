const DAMAGE_TYPE_DEFINITIONS = [
  { key: "physical", label: "Physical", icon: "🗡️" },
  { key: "piercing", label: "Piercing", icon: "🗡️" },
  { key: "slashing", label: "Slashing", icon: "🪓" },
  { key: "bludgeoning", label: "Bludgeoning", icon: "🔨" },
  { key: "cold", label: "Cold", icon: "❄️" },
  { key: "fire", label: "Fire", icon: "🔥" },
  { key: "lightning", label: "Lightning", icon: "⚡" },
  { key: "poison", label: "Poison", icon: "☠️" },
  { key: "psychic", label: "Psychic", icon: "🧠" },
  { key: "arcane", label: "Arcane", icon: "✨" },
  { key: "radiant", label: "Radiant", icon: "🌟" },
  { key: "necrotic", label: "Necrotic", icon: "💀" },
];

export const DAMAGE_TYPES = Object.freeze(
  DAMAGE_TYPE_DEFINITIONS.map((entry) => Object.freeze({ ...entry })),
);

export const DAMAGE_TYPE_KEYS = Object.freeze(DAMAGE_TYPES.map((entry) => entry.key));

const DAMAGE_TYPES_BY_KEY = Object.freeze(
  DAMAGE_TYPES.reduce((acc, entry) => {
    acc[entry.key] = entry;
    return acc;
  }, {}),
);

export function isDamageType(value) {
  return Object.hasOwn(DAMAGE_TYPES_BY_KEY, String(value ?? "").trim().toLowerCase());
}

export function normalizeDamageType(value, fallback = "physical") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (isDamageType(normalized)) return normalized;
  const fallbackNormalized = String(fallback ?? "physical").trim().toLowerCase();
  return isDamageType(fallbackNormalized) ? fallbackNormalized : "physical";
}

export function getDamageTypeLabel(value) {
  const key = normalizeDamageType(value);
  return DAMAGE_TYPES_BY_KEY[key]?.label ?? key;
}

export function getDamageTypeIcon(value) {
  const key = normalizeDamageType(value);
  return DAMAGE_TYPES_BY_KEY[key]?.icon ?? "";
}
