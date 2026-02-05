export const EFFECT_TARGETS = [
  { key: "condition", label: "Самочувствие" },
  { key: "attention", label: "Внимание" },
  { key: "movement", label: "Движение" },
  { key: "combat", label: "Сражение" },
  { key: "thinking", label: "Мышление" },
  { key: "communication", label: "Общение" },
  { key: "rollAdv", label: "Все броски: преимущество" },
  { key: "rollDis", label: "Все броски: помеха" },
  { key: "rollFullAdv", label: "Все броски: удачливый (полный переброс)" },
  { key: "rollFullDis", label: "Все броски: неудачливый (полный переброс)" },
  { key: "hpMax", label: "Макс. HP" },
  { key: "inspMax", label: "Макс. вдохновение" },
  { key: "speed", label: "Скорость" },
  { key: "weaponAdv", label: "Атака оружием: преимущество" },
  { key: "weaponDis", label: "Атака оружием: помеха" },
  { key: "dodgeAdv", label: "Уворот: преимущество" },
  { key: "dodgeDis", label: "Уворот: помеха" },
  { key: "blockAdv", label: "Блок: преимущество" },
  { key: "blockDis", label: "Блок: помеха" },
];

const EFFECT_KEYS = new Set(EFFECT_TARGETS.map((t) => t.key));

const clampValue = (n, min, max) => Math.min(Math.max(n, min), max);
const numValue = (v, d) => {
  const x = Number(v);
  return Number.isNaN(x) ? d : x;
};

export const normalizeEffects = (raw, { keepZero = false } = {}) => {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const key = String(entry.key ?? "").trim();
    if (!EFFECT_KEYS.has(key)) continue;
    const value = numValue(entry.value, 0);
    if (!Number.isFinite(value)) continue;
    if (!keepZero && value === 0) continue;
    out.push({ key, value });
  }
  return out;
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
      if (!item.system?.active) continue;
    } else if (item.type !== "skill" && item.type !== "state") {
      continue;
    }

    const effects = normalizeEffects(item.system?.effects);
    for (const eff of effects) add(eff.key, eff.value);
  }

  return totals;
};

export const getEffectValue = (totals, key) => {
  const v = numValue(totals?.[key], 0);
  return Number.isFinite(v) ? v : 0;
};

export const getEffectiveAttribute = (attrs, key, totals) => {
  const base = clampValue(numValue(attrs?.[key], 1), 1, 6);
  const total = base + getEffectValue(totals, key);
  return clampValue(total, 1, 6);
};

export const getGlobalRollModifiers = (totals) => {
  const adv = Math.max(0, getEffectValue(totals, "rollAdv"));
  const dis = Math.max(0, getEffectValue(totals, "rollDis"));
  const fullAdv = Math.max(0, getEffectValue(totals, "rollFullAdv"));
  const fullDis = Math.max(0, getEffectValue(totals, "rollFullDis"));
  let fullMode = "normal";
  if (fullAdv > fullDis) fullMode = "adv";
  else if (fullDis > fullAdv) fullMode = "dis";
  return { adv, dis, fullMode };
};

const renderEffectRow = (effect = {}) => {
  const key = EFFECT_KEYS.has(effect.key) ? effect.key : EFFECT_TARGETS[0].key;
  const value = Number.isFinite(effect.value) ? effect.value : 0;
  const options = EFFECT_TARGETS.map((opt) => {
    const selected = opt.key === key ? " selected" : "";
    return `<option value="${opt.key}"${selected}>${opt.label}</option>`;
  }).join("");

  return `
    <div class="v-effects__row">
      <select class="v-effects__key">${options}</select>
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
    html.on("click", ".v-effects__add", (ev) => {
      ev.preventDefault();
      html.find(".v-effects__rows").append(renderEffectRow());
    });
    html.on("click", ".v-effects__remove", (ev) => {
      ev.preventDefault();
      $(ev.currentTarget).closest(".v-effects__row").remove();
      if (!html.find(".v-effects__row").length) {
        html.find(".v-effects__rows").append(renderEffectRow());
      }
    });
  });

  dialog.render(true);
};
