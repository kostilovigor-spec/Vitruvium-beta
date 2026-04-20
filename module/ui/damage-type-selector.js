import {
  DAMAGE_TYPES,
  normalizeDamageType,
} from "../config/damage-types.js";

const toUniqueTypes = (types = []) => {
  const out = [];
  for (const type of types) {
    const normalized = normalizeDamageType(type);
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
};

export async function openDamageTypeSelector({
  title = "Damage Types",
  selected = [],
} = {}) {
  const selectedSet = new Set(toUniqueTypes(selected));
  const content = `
    <form class="v-damage-type-selector" style="display:grid; gap:8px;">
      <div style="font-weight:600;">Выберите типы урона:</div>
      <div style="display:grid; gap:4px;">
        ${DAMAGE_TYPES.map((type) => `
          <label style="display:flex; align-items:center; gap:8px;">
            <input type="checkbox" name="damageType" value="${type.key}" ${selectedSet.has(type.key) ? "checked" : ""}/>
            <span>${type.icon} ${type.label}</span>
          </label>
        `).join("")}
      </div>
    </form>
  `;

  return new Promise((resolve) => {
    new Dialog({
      title,
      content,
      buttons: {
        apply: {
          label: "Применить",
          callback: (html) => {
            const picked = [];
            html.find("input[name='damageType']:checked").each((_idx, el) => {
              picked.push(normalizeDamageType(el.value));
            });
            resolve(toUniqueTypes(picked));
          },
        },
        cancel: {
          label: "Отмена",
          callback: () => resolve(null),
        },
      },
      default: "apply",
      close: () => resolve(null),
    }).render(true);
  });
}
