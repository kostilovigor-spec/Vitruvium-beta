import { clamp, toNumber } from "./utils/number.js";
import { escapeHtml } from "./utils/string.js";
import { playAutomatedAnimation } from "./auto-animations.js";
import { DiceSystem } from "./core/dice-system.js";
import { DamageResolver } from "./core/damage-resolver.js";
import { ConditionResolver } from "./core/condition-resolver.js";
import {
  normalizeModifiers,
  collectEffectTotals,
  getEffectValue,
  getEffectiveAttribute,
  getAttributeRollModifiers,
  getAttackRollModifiers,
  getLuckModifiers,
  getGlobalRollModifiers,
} from "./effects.js";
import { getStateTemplateByUuid } from "./state-library.js";
import { chatVisibilityData } from "./chat-visibility.js";
import { ActionProcessor } from "./core/action-processor.js";

// Vitruvium combat.js — v13 (chat-button flow, GM resolve via createChatMessage hook)
// Goal: Players must NEVER see the "Результат" card with "Применить урон".
// Defender client posts a GM-only "resolveRequest" message.
// GM client listens to createChatMessage for that flag and posts Resolve (GM-only).
// Attack and defense cards follow current core chat roll mode.

function renderFacesInline(results = []) {
  const arr = Array.isArray(results) ? results : [];
  if (!arr.length) return "";
  const iconBlank = "–";
  const iconSingle = "♦";
  const iconDouble = "♦♦";
  const parts = arr.map((v) => {
    const kind = DiceSystem.classifyFace(v);
    const icon =
      kind === "double"
        ? iconDouble
        : kind === "single"
          ? iconSingle
          : iconBlank;
    return `<span class="v-face v-face--${kind}" data-face="${kind}">${icon}</span>`;
  });
  return `<div class="v-faces v-faces--inline">${parts.join("")}</div>`;
}

function modeLabel(luck = 0, unluck = 0) {
  const l = Number(luck) || 0;
  const u = Number(unluck) || 0;
  if (l <= 0 && u <= 0) return "Обычный";
  const adv = l === 1 ? "С преимуществом" : `С ${l} преимуществами`;
  const dis = u === 1 ? "С помехой" : `С ${u} помехами`;
  if (l > 0 && u <= 0) return adv;
  if (u > 0 && l <= 0) return dis;
  return `${adv} / ${dis}`;
}

function fullModeLabel(mode) {
  const m = String(mode ?? "normal");
  if (m === "adv") return "Удачливый (полный переброс)";
  if (m === "dis") return "Неудачливый (полный переброс)";
  return "Обычный";
}

function chosenResults(r) {
  if (!r) return [];
  return r.results ?? r.all?.[0]?.results ?? [];
}




const FLAG_SCOPE_PRIMARY = "Vitruvium";
const FLAG_SCOPE_LEGACY = "vitruvium";
const SOCKET_EVENT_GM_APPLY = "vitruvium-gm-apply-message";
const SOCKET_NAMESPACE_PRIMARY = () => `system.${game.system.id}`;
const SOCKET_NAMESPACE_LEGACY = "system.vitruvium";

function readCombatFlags(doc) {
  return (
    doc?.flags?.[FLAG_SCOPE_PRIMARY] ??
    doc?.flags?.[FLAG_SCOPE_LEGACY] ??
    null
  );
}

function buildCombatFlags(payload) {
  return {
    [FLAG_SCOPE_PRIMARY]: payload,
    [FLAG_SCOPE_LEGACY]: payload,
  };
}

function emitSocketToGm(payload) {
  const nsPrimary = SOCKET_NAMESPACE_PRIMARY();
  game.socket?.emit?.(nsPrimary, payload);
  if (nsPrimary !== SOCKET_NAMESPACE_LEGACY) {
    game.socket?.emit?.(SOCKET_NAMESPACE_LEGACY, payload);
  }
}

function normalizeDefenseTarget(target) {
  const defenderTokenUuid = String(target?.defenderTokenUuid ?? "").trim();
  if (!defenderTokenUuid) return null;
  const defenderName = String(target?.defenderName ?? "цель").trim() || "цель";
  return { defenderTokenUuid, defenderName };
}

function collectSelectedDefenseTargets() {
  const out = [];
  for (const token of game.user.targets ?? []) {
    const norm = normalizeDefenseTarget({
      defenderTokenUuid: token?.document?.uuid,
      defenderName: token?.name ?? token?.actor?.name,
    });
    if (!norm) continue;
    if (!out.some((t) => t.defenderTokenUuid === norm.defenderTokenUuid)) {
      out.push(norm);
    }
  }
  return out;
}

function getDefenseTargetsFromFlags(flags) {
  const raw = Array.isArray(flags?.defenderTargets)
    ? flags.defenderTargets
    : [];
  const out = raw.map(normalizeDefenseTarget).filter(Boolean);
  if (out.length) return out;
  const fallback = normalizeDefenseTarget({
    defenderTokenUuid: flags?.defenderTokenUuid,
    defenderName: flags?.defenderName,
  });
  return fallback ? [fallback] : [];
}

function getResolvedDefenderUuids(flags) {
  const raw = Array.isArray(flags?.resolvedDefenderUuids)
    ? flags.resolvedDefenderUuids
    : [];
  const out = [];
  for (const uuid of raw) {
    const id = String(uuid ?? "").trim();
    if (!id) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function getResolvedContestDefenderUuids(flags) {
  const raw = Array.isArray(flags?.resolvedContestDefenderUuids)
    ? flags.resolvedContestDefenderUuids
    : [];
  const out = [];
  for (const uuid of raw) {
    const id = String(uuid ?? "").trim();
    if (!id) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function defenseLabel(defenseTargets) {
  if (!Array.isArray(defenseTargets) || defenseTargets.length === 0) {
    return "без цели";
  }
  if (defenseTargets.length === 1) return defenseTargets[0].defenderName;
  return `${defenseTargets.length} целей`;
}

function attackResolveLockKey(messageId, defenderTokenUuid, flow = "defense") {
  return `${messageId}::${defenderTokenUuid ?? ""}::${flow}`;
}

const _resolvedAttackDefenseKeys = new Set();

// rollPool — делегируем в DiceSystem (единственная реализация)
const rollPool = (pool, opts) => DiceSystem.rollPool(pool, opts);

function renderModeDetailSmall(r) {
  if (!r) return "";
  const fullText = fullModeLabel(r.fullMode);
  const text =
    r.fullMode === "adv" || r.fullMode === "dis"
      ? fullText
      : modeLabel(r.luck, r.unluck);
  return `<div class="v-sub">${text} · пул ${r.pool}</div>`;
}

function prettyAttrLabel(key) {
  const map = {
    condition: "Самочувствие",
    attention: "Внимание",
    movement: "Движение",
    combat: "Сражение",
    thinking: "Мышление",
    communication: "Общение",
    will: "Воля",
  };
  return map[key] ?? key;
}

function listAttributeKeys(actor) {
  const attrs = actor.system?.attributes ?? {};
  const allowed = [
    "condition",
    "attention",
    "movement",
    "combat",
    "thinking",
    "communication",
  ];
  return allowed.filter((k) => {
    const raw = attrs[k];
    if (typeof raw === "number") return Number.isFinite(raw);
    if (raw && typeof raw === "object" && "value" in raw) {
      return Number.isFinite(Number(raw.value));
    }
    return false;
  });
}

function getWeaponDamage(actor, weaponItem = null) {
  if (weaponItem) return clamp(toNumber(weaponItem.system?.attackBonus, 0), 0, 99);
  let best = 0;
  for (const it of actor.items ?? []) {
    if (it.type !== "item") continue;
    if (!it.system?.equipped) continue;
    best = Math.max(best, toNumber(it.system.attackBonus ?? 0, 0));
  }
  return best;
}

function getWeaponRollMods(weaponItem) {
  const effects = normalizeModifiers(weaponItem?.system?.effects);
  const totals = {};
  for (const eff of effects) {
    totals[eff.key] = (totals[eff.key] ?? 0) + toNumber(eff.value, 0);
  }
  return getLuckModifiers(totals, {
    advKey: "weaponAdv",
    disKey: "weaponDis",
    luckyKey: "weaponLucky",
    unluckyKey: "weaponUnlucky",
  });
}

function hasHeavyArmorEquipped(actor) {
  for (const it of actor.items ?? []) {
    if (it.type !== "item") continue;
    if (!it.system?.equipped) continue;
    if (it.system?.isHeavyArmor) return true;
  }
  return false;
}

function hasBlockWeaponEquipped(actor) {
  // Предметы с флагом canBlock (должны быть экипированы)
  for (const it of actor.items ?? []) {
    if (it.type !== "item") continue;
    if (!it.system?.equipped) continue;
    if (it.system?.canBlock) return true;
  }

  // Способности с флагом canBlock (должны быть активны)
  for (const it of actor.items ?? []) {
    if (it.type !== "ability") continue;
    if (it.system?.active === false) continue;
    if (it.system?.canBlock) return true;
  }

  // Навыки с флагом canBlock (всегда работают)
  for (const it of actor.items ?? []) {
    if (it.type !== "skill") continue;
    if (it.system?.canBlock) return true;
  }

  // Состояния с флагом canBlock (должны быть активны)
  for (const it of actor.items ?? []) {
    if (it.type !== "state") continue;
    if (it.system?.active === false) continue;
    if (it.system?.canBlock) return true;
  }

  return false;
}

function getArmorTotal(actor, { includeShield = true } = {}) {
  const base = toNumber(
    actor.system?.attributes?.armor?.value ?? actor.system?.attributes?.armor,
    0,
  );
  let bonus = 0;
  for (const it of actor.items ?? []) {
    if (it.type !== "item") continue;
    if (!it.system?.equipped) continue;
    const isShield = !!it.system?.isShield;
    if (!includeShield && isShield) continue;
    bonus += clamp(toNumber(it.system.armorBonus, 0), 0, 6);
  }

  // Добавляем значение брони из эффектов
  const effectTotals = collectEffectTotals(actor);
  const armorFromEffects = getEffectValue(effectTotals, "armorValue");

  return base + bonus + armorFromEffects;
}

/* ---------- Dialogs ---------- */

/**
 * Универсальный диалог для броска пула dV.
 */
export async function genericRollDialog({
  title = "Бросок",
  pool = 1,
  showPool = true,
  actor = null
} = {}) {
  const defaultLuck = 0;
  const defaultUnluck = 0;
  const defaultExtraDice = 0;
  const defaultFullMode = "normal";

  const content = `
    <div style="display:grid; gap:8px;">
        ${showPool ? `
        <label>Пул кубов
          <input type="number" name="pool" value="${pool}" min="1" max="20" style="width:100%"/>
        </label>` : ""}
        <label>Удачливый бросок
          <select name="fullMode" style="width:100%">
            <option value="normal" ${defaultFullMode === "normal" ? "selected" : ""}>Обычный</option>
            <option value="adv" ${defaultFullMode === "adv" ? "selected" : ""}>Удачливый (полный переброс)</option>
            <option value="dis" ${defaultFullMode === "dis" ? "selected" : ""}>Неудачливый (полный переброс)</option>
          </select>
        </label>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <label>Преимущество
            <input type="number" name="luck" value="${defaultLuck}" min="0" max="20" step="1" style="width:100%"/>
          </label>
          <label>Помеха
            <input type="number" name="unluck" value="${defaultUnluck}" min="0" max="20" step="1" style="width:100%"/>
          </label>
        </div>
        <label>Доп. кубы (можно отрицательное)
          <input type="number" name="extraDice" value="${defaultExtraDice}" min="-20" max="20" step="1" style="width:100%"/>
        </label>
        <div style="font-size:12px; opacity:.75;">Каждый счетчик преимущества/помехи перебрасывает один куб.</div>
    </div>`;

  return new Promise((resolve) => {
    new Dialog({
      title,
      content,
      buttons: {
        roll: {
          label: "Бросить",
          callback: (html) => resolve({
            pool: showPool ? clamp(toNumber(html.find("input[name='pool']").val(), pool), 1, 20) : pool,
            luck: clamp(toNumber(html.find("input[name='luck']").val(), 0), 0, 20),
            unluck: clamp(toNumber(html.find("input[name='unluck']").val(), 0), 0, 20),
            extraDice: clamp(toNumber(html.find("input[name='extraDice']").val(), 0), -20, 20),
            fullMode: html.find("select[name='fullMode']").val(),
          })
        },
        cancel: { label: "Отмена", callback: () => resolve(null) }
      },
      default: "roll",
      close: () => resolve(null)
    }).render(true);
  });
}


function attackDialog({ actor, weaponName, defaultAttrKey }) {
  const keys = listAttributeKeys(actor);
  const fallbackKey = keys.includes("combat")
    ? "combat"
    : (keys[0] ?? "combat");
  const defaultKey = keys.includes(defaultAttrKey)
    ? defaultAttrKey
    : fallbackKey;
  const defaultLuck = 0;
  const defaultUnluck = 0;
  const defaultExtraDice = 0;
  const defaultFullMode = "normal";
  const options = keys
    .map(
      (k) =>
        `<option value="${k}" ${k === defaultKey ? "selected" : ""}>${escapeHtml(
          prettyAttrLabel(k),
        )}</option>`,
    )
    .join("");

  return new Promise((resolve) => {
    new Dialog({
      title: `Атака: ${weaponName}`,
      content: `<div style="display:grid; gap:8px;">
        <label>Атрибут атаки
          <select name="attr" style="width:100%">${options}</select>
        </label>
        <label>Удачливый бросок
          <select name="fullMode" style="width:100%">
            <option value="normal" ${defaultFullMode === "normal" ? "selected" : ""}>Обычный</option>
            <option value="adv" ${defaultFullMode === "adv" ? "selected" : ""}>Удачливый (полный переброс)</option>
            <option value="dis" ${defaultFullMode === "dis" ? "selected" : ""}>Неудачливый (полный переброс)</option>
          </select>
        </label>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <label>Преимущество
            <input type="number" name="luck" value="${defaultLuck}" min="0" max="20" step="1" style="width:100%"/>
          </label>
          <label>Помеха
            <input type="number" name="unluck" value="${defaultUnluck}" min="0" max="20" step="1" style="width:100%"/>
          </label>
        </div>
        <label>Доп. кубы (можно отрицательное)
          <input type="number" name="extraDice" value="${defaultExtraDice}" min="-20" max="20" step="1" style="width:100%"/>
        </label>
        <div style="font-size:12px; opacity:.75;">Положительное число увеличивает пул кубов, отрицательное уменьшает.</div>
        <div style="font-size:12px; opacity:.75;">Каждый счетчик преимущества/помехи перебрасывает один куб. Удачливый/неудачливый бросок игнорирует счетчики.</div>
      </div>`,
      buttons: {
        roll: {
          label: "Бросить",
          callback: (html) =>
            resolve({
              attrKey: html.find("select[name='attr']").val(),
              luck: clamp(toNumber(html.find("input[name='luck']").val(), 0), 0, 20),
              unluck: clamp(
                toNumber(html.find("input[name='unluck']").val(), 0),
                0,
                20,
              ),
              extraDice: clamp(
                toNumber(html.find("input[name='extraDice']").val(), 0),
                -20,
                20,
              ),
              fullMode: html.find("select[name='fullMode']").val(),
            }),
        },
        cancel: {
          label: "Отмена",
          callback: () => resolve(null),
        },
      },
      default: "roll",
      close: () => resolve(null),
    }).render(true);
  });
}

function defenseDialog({
  allowDodge = true,
  allowBlock = true,
  actor = null,
} = {}) {
  return new Promise((resolve) => {
    const defaultLuck = 0;
    const defaultUnluck = 0;
    const defaultExtraDice = 0;
    const defaultFullMode = "normal";
    const buttons = {};
    if (allowDodge) {
      buttons.dodge = {
        label: "Уклонение",
        callback: (html) =>
          resolve({
            type: "dodge",
            luck: clamp(toNumber(html.find("input[name='luck']").val(), 0), 0, 20),
            unluck: clamp(
              toNumber(html.find("input[name='unluck']").val(), 0),
              0,
              20,
            ),
            extraDice: clamp(
              toNumber(html.find("input[name='extraDice']").val(), 0),
              -20,
              20,
            ),
            fullMode: html.find("select[name='fullMode']").val(),
          }),
      };
    }
    if (allowBlock) {
      buttons.block = {
        label: allowDodge ? "Блок" : "Принять удар (тяж. броня)",
        callback: (html) =>
          resolve({
            type: "block",
            luck: clamp(toNumber(html.find("input[name='luck']").val(), 0), 0, 20),
            unluck: clamp(
              toNumber(html.find("input[name='unluck']").val(), 0),
              0,
              20,
            ),
            extraDice: clamp(
              toNumber(html.find("input[name='extraDice']").val(), 0),
              -20,
              20,
            ),
            fullMode: html.find("select[name='fullMode']").val(),
          }),
      };
    }
    new Dialog({
      title: "Защита",
      content: `<div style="display:grid; gap:8px;">
        <div>${allowDodge && allowBlock
          ? "Выберите реакцию защиты"
          : allowDodge
            ? "Доступно только уклонение."
            : "<b>Тяжёлые доспехи:</b> уклонение недоступно. Можно только принять удар."
        }</div>
        <label>Удачливый бросок
          <select name="fullMode" style="width:100%">
            <option value="normal" ${defaultFullMode === "normal" ? "selected" : ""}>Обычный</option>
            <option value="adv" ${defaultFullMode === "adv" ? "selected" : ""}>Удачливый (полный переброс)</option>
            <option value="dis" ${defaultFullMode === "dis" ? "selected" : ""}>Неудачливый (полный переброс)</option>
          </select>
        </label>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <label>Преимущество
            <input type="number" name="luck" value="${defaultLuck}" min="0" max="20" step="1" style="width:100%"/>
          </label>
          <label>Помеха
            <input type="number" name="unluck" value="${defaultUnluck}" min="0" max="20" step="1" style="width:100%"/>
          </label>
        </div>
        <label>Доп. кубы (можно отрицательное)
          <input type="number" name="extraDice" value="${defaultExtraDice}" min="-20" max="20" step="1" style="width:100%"/>
        </label>
        <div style="font-size:12px; opacity:.75;">Положительное число увеличивает пул кубов, отрицательное уменьшает.</div>
        <div style="font-size:12px; opacity:.75;">Каждый счетчик преимущества/помехи перебрасывает один куб. Удачливый/неудачливый бросок игнорирует счетчики.</div>
      </div>`,
      buttons,
      close: () => resolve(null),
    }).render(true);
  });
}

function contestDialog({
  actor = null,
  defaultAttrKey = "combat",
  title = "Сопротивление",
} = {}) {
  const keys = listAttributeKeys(actor);
  const fallbackKey = keys.includes("combat")
    ? "combat"
    : (keys[0] ?? "combat");
  const defaultKey = keys.includes(defaultAttrKey)
    ? defaultAttrKey
    : fallbackKey;
  const defaultLuck = 0;
  const defaultUnluck = 0;
  const defaultExtraDice = 0;
  const defaultFullMode = "normal";
  const options = keys
    .map(
      (k) =>
        `<option value="${k}" ${k === defaultKey ? "selected" : ""}>${escapeHtml(
          prettyAttrLabel(k),
        )}</option>`,
    )
    .join("");

  return new Promise((resolve) => {
    new Dialog({
      title,
      content: `<div style="display:grid; gap:8px;">
        <label>Атрибут сопротивления
          <select name="attr" style="width:100%">${options}</select>
        </label>
        <label>Удачливый бросок
          <select name="fullMode" style="width:100%">
            <option value="normal" ${defaultFullMode === "normal" ? "selected" : ""
        }>Обычный</option>
            <option value="adv" ${defaultFullMode === "adv" ? "selected" : ""
        }>Удачливый (полный переброс)</option>
            <option value="dis" ${defaultFullMode === "dis" ? "selected" : ""
        }>Неудачливый (полный переброс)</option>
          </select>
        </label>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <label>Преимущество
            <input type="number" name="luck" value="${defaultLuck}" min="0" max="20" step="1" style="width:100%"/>
          </label>
          <label>Помеха
            <input type="number" name="unluck" value="${defaultUnluck}" min="0" max="20" step="1" style="width:100%"/>
          </label>
        </div>
        <label>Доп. кубы (можно отрицательное)
          <input type="number" name="extraDice" value="${defaultExtraDice}" min="-20" max="20" step="1" style="width:100%"/>
        </label>
        <div style="font-size:12px; opacity:.75;">Положительное число увеличивает пул кубов, отрицательное уменьшает.</div>
        <div style="font-size:12px; opacity:.75;">Каждый счетчик преимущества/помехи перебрасывает один куб. Удачливый/неудачливый бросок игнорирует счетчики.</div>
      </div>`,
      buttons: {
        roll: {
          label: "Бросить",
          callback: (html) =>
            resolve({
              attrKey: html.find("select[name='attr']").val(),
              luck: clamp(toNumber(html.find("input[name='luck']").val(), 0), 0, 20),
              unluck: clamp(
                toNumber(html.find("input[name='unluck']").val(), 0),
                0,
                20,
              ),
              extraDice: clamp(
                toNumber(html.find("input[name='extraDice']").val(), 0),
                -20,
                20,
              ),
              fullMode: html.find("select[name='fullMode']").val(),
            }),
        },
        cancel: { label: "Отмена", callback: () => resolve(null) },
      },
      default: "roll",
      close: () => resolve(null),
    }).render(true);
  });
}

/* ---------- Cards ---------- */

function renderCollapsibleBox({
  label,
  value,
  roll,
  detailHtml = "",
  extraClass = "",
  extraHtml = "",
}) {
  const rollHtml =
    roll && (chosenResults(roll).length || roll.pool)
      ? `${renderModeDetailSmall(roll)}${renderFacesInline(chosenResults(roll))}`
      : "";
  const bodyContent = `${detailHtml}${rollHtml}`;
  const cls = `v-box${extraClass ? ` ${extraClass}` : ""}`;
  if (!bodyContent) {
    return `<div class="${cls}">
      <div class="v-box__label">${label}</div>
      <div class="v-box__big">${value}</div>
      ${extraHtml}
    </div>`;
  }
  return `<div class="${cls}">
    <details class="v-details">
      <summary class="v-details__summary">
        <span class="v-box__label">${label}</span>
        <span class="v-box__big">${value}</span>
      </summary>
      <div class="v-details__body">
        ${bodyContent}
      </div>
    </details>
    ${extraHtml}
  </div>`;
}

function attackCardTwoCols({
  attackerName,
  defenderLabel,
  weaponName,
  attrKey,
  atkRoll,
  damageInfo,
  healInfo,
  defenseTargets = [],
  resolvedResults = [],
}) {
  const wdmg = toNumber(damageInfo?.base ?? 0, 0);
  const atkSucc = toNumber(atkRoll?.successes, 0);
  const predictedDamage = Math.max(0, wdmg + atkSucc);
  const dmgFormula = `<div class="v-sub">${wdmg} (оружие) + ${atkSucc} (успехи) = ${predictedDamage}</div>`;
  const resolvedDefenderUuids = resolvedResults.map(r => r.uuid);
  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--attack">
    <div class="v-head">
      <div class="v-title">${escapeHtml(attackerName)} атакует ${escapeHtml(
    defenderLabel,
  )}</div>
      <div class="v-sub">Оружие: <b>${escapeHtml(weaponName)}</b> · Атрибут: ${escapeHtml(
    prettyAttrLabel(attrKey),
  )}</div>
    </div>

    <div class="v-two">
      ${renderCollapsibleBox({ label: "Атака", value: atkRoll.successes, roll: atkRoll })}
      ${renderCollapsibleBox({ label: "Урон", value: predictedDamage, detailHtml: dmgFormula })}
    </div>
    ${renderDefenseTargets({ defenseTargets, resolvedDefenderUuids, resolvedResults, predictedDamage })}
  </div>`;
}

function renderDefenseTargets({
  defenseTargets = [],
  resolvedDefenderUuids = [],
  resolvedResults = [],
  predictedDamage = 0,
  hint = "",
  resolvedHint = "Защита уже выбрана",
}) {
  if (!Array.isArray(defenseTargets) || defenseTargets.length === 0) return "";
  const resolved = new Set(
    (Array.isArray(resolvedDefenderUuids) ? resolvedDefenderUuids : []).map(
      (v) => String(v ?? ""),
    ),
  );
  const rows = defenseTargets
    .map((target) => {
      const norm = normalizeDefenseTarget(target);
      if (!norm) return "";
      const isResolved = resolved.has(norm.defenderTokenUuid);
      const statusHtml = isResolved ? resolvedHint : hint;

      return `
      <div data-defender-token-uuid="${escapeHtml(
        norm.defenderTokenUuid,
      )}" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;">
        <div class="v-sub"><b>${escapeHtml(norm.defenderName)}</b></div>
        <button type="button" class="v-btn" data-action="vitruvium-defense" data-defender-token-uuid="${escapeHtml(
        norm.defenderTokenUuid,
      )}" ${isResolved ? "disabled" : ""}>Защита</button>
        <div class="v-sub" data-role="defense-status" style="grid-column:1 / -1;">${statusHtml}</div>
      </div>`;
    })
    .filter(Boolean)
    .join("");
  if (!rows) return "";
  return `
    <div class="v-actions" style="display:grid;gap:8px;">
      <div class="v-sub">Цели:</div>
      ${rows}
    </div>
  `;
}

function renderContestTargets({
  contestTargets = [],
  resolvedContestDefenderUuids = [],
  hint = "",
  resolvedHint = "Сопротивление уже выбрано",
}) {
  if (!Array.isArray(contestTargets) || contestTargets.length === 0) return "";
  const resolved = new Set(
    (Array.isArray(resolvedContestDefenderUuids)
      ? resolvedContestDefenderUuids
      : []
    ).map((v) => String(v ?? "")),
  );
  const rows = contestTargets
    .map((target) => {
      const norm = normalizeDefenseTarget(target);
      if (!norm) return "";
      const isResolved = resolved.has(norm.defenderTokenUuid);
      return `
      <div data-contest-defender-token-uuid="${escapeHtml(
        norm.defenderTokenUuid,
      )}" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;">
        <div class="v-sub"><b>${escapeHtml(norm.defenderName)}</b></div>
        <button type="button" class="v-btn" data-action="vitruvium-contest" data-defender-token-uuid="${escapeHtml(
        norm.defenderTokenUuid,
      )}" ${isResolved ? "disabled" : ""}>Сопротивление</button>
        <div class="v-sub" data-role="contest-status" style="grid-column:1 / -1;">${isResolved ? resolvedHint : hint}</div>
      </div>`;
    })
    .filter(Boolean)
    .join("");
  if (!rows) return "";
  return `
    <div class="v-actions" style="display:grid;gap:8px;">
      <div class="v-sub">Сопротивление состояния:</div>
      ${rows}
    </div>
  `;
}

function renderGmApplyButtons({ defenderTokenUuid, defenderName = "", damage, isHealing = false }) {
  const action = isHealing ? "vitruvium-apply-healing" : "vitruvium-apply-damage";
  const btnClass = isHealing ? "v-btn--success" : "v-btn--danger";
  const btnLabel = isHealing ? `Лечение (${damage})` : `Урон (${damage})`;
  const nameHtml = defenderName
    ? `<span class="v-dmg-name">${escapeHtml(defenderName)}</span>`
    : "";

  return `
    <div class="v-dmg-row gm-only">
      ${nameHtml}
      <select data-role="dmg-multiplier" class="v-dmg-mul">
        <option value="0">×0</option>
        <option value="0.5">×0.5</option>
        <option value="1" selected>×1</option>
        <option value="1.5">×1.5</option>
        <option value="2">×2</option>
      </select>
      <button type="button" class="v-btn ${btnClass} v-dmg-btn" data-action="${action}" data-defender-token-uuid="${escapeHtml(defenderTokenUuid)}" data-damage="${damage}">${btnLabel}</button>
    </div>
  `;
}

async function cleanupPredictedGmApplyMessages({
  attackMessageId = "",
  defenderTokenUuid = "",
  isHealing = false,
}) {
  if (!game.user?.isGM) return;
  const aid = String(attackMessageId ?? "").trim();
  const duid = String(defenderTokenUuid ?? "").trim();
  if (!aid || !duid) return;
  for (const msg of game.messages ?? []) {
    const mf = readCombatFlags(msg);
    if (!mf) continue;
    if (mf.applyPhase !== "predicted") continue;
    if (String(mf.attackMessageId ?? "") !== aid) continue;
    if (String(mf.defenderTokenUuid ?? "") !== duid) continue;
    if (!!mf.isHealing !== !!isHealing) continue;
    try {
      await msg.delete();
    } catch (_e) {
      /* ignore */
    }
  }
}

async function createGmApplyMessage({
  title = "Бросок ведущему",
  subtitle = "",
  rows = [],
  attackMessageId = null,
  applyPhase = "manual",
}) {
  const cleanRows = (Array.isArray(rows) ? rows : []).filter(
    (r) =>
      r &&
      Number.isFinite(Number(r.damage ?? 0)) &&
      Number(r.damage ?? 0) >= 0,
  );
  if (!cleanRows.length) return;

  if (!game.user?.isGM) {
    const requestId =
      foundry?.utils?.randomID?.() ??
      `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    emitSocketToGm({
      type: SOCKET_EVENT_GM_APPLY,
      requestId,
      payload: { title, subtitle, rows: cleanRows, attackMessageId, applyPhase },
    });
    return;
  }

  for (const row of cleanRows) {
    const defenderTokenUuid = String(row.defenderTokenUuid ?? "").trim();
    const isHealing = !!row.isHealing;
    const kind = isHealing ? "applyHealing" : "applyDamage";
    const dmg = Math.max(0, Math.floor(toNumber(row.damage, 0)));
    const prefix = row.label ? `<div class="v-sub"><b>${escapeHtml(row.label)}</b></div>` : "";

    if (attackMessageId && applyPhase === "resolved") {
      for (const msg of game.messages ?? []) {
        const mf = readCombatFlags(msg);
        if (!mf) continue;
        if (mf.applyPhase !== "predicted") continue;
        if (String(mf.attackMessageId ?? "") !== String(attackMessageId)) continue;
        if (String(mf.defenderTokenUuid ?? "") !== defenderTokenUuid) continue;
        if (!!mf.isHealing !== isHealing) continue;
        try {
          await msg.delete();
        } catch (_e) {
          /* ignore */
        }
      }
    }

    const targetDoc = defenderTokenUuid ? fromUuidSync(defenderTokenUuid) : null;
    const defName = String(row.label || targetDoc?.name || targetDoc?.actor?.name || "Цель").trim();
    const content = renderGmApplyButtons({
      defenderTokenUuid,
      defenderName: defName,
      damage: dmg,
      isHealing,
    });
    await ChatMessage.create({
      ...chatVisibilityData({ gmOnly: true }),
      content,
      flags: buildCombatFlags({
        kind,
        defenderTokenUuid,
        damage: dmg,
        isHealing,
        attackMessageId: attackMessageId ? String(attackMessageId) : "",
        applyPhase,
      }),
    });
  }
}

function abilityAttackCard({
  attackerName,
  defenderLabel,
  abilityName,
  attrKey,
  atkRoll,
  damageInfo,
  healInfo,
  defenseTargets = [],
  resolvedResults = [],
  contestTargets = [],
  resolvedContestDefenderUuids = [],
  showDefense = true,
  showContest = false,
  contestCasterAttr = null,
  contestTargetAttr = null,
  contestCasterSuccesses = null,
  isAttack = true,
}) {
  const resolvedDefenderUuids = resolvedResults.map(r => r.uuid);

  const hasAttack = !!atkRoll && isAttack;
  const hasDamage = !!damageInfo && damageInfo.base > 0;
  const hasHeal = !!healInfo && healInfo.base > 0;
  const atkSucc = toNumber(atkRoll?.successes, 0);
  const dmgFormula = hasDamage
    ? `<div class="v-sub">${damageInfo.base} (способность)${hasAttack ? ` + ${atkSucc} (успехи)` : ""} = ${damageInfo.total}</div>`
    : "";
  const healFormula = hasHeal
    ? `<div class="v-sub">${healInfo.base} (способность)${hasAttack ? ` + ${atkSucc} (успехи)` : ""} = ${healInfo.total}</div>`
    : "";
  const healExtra =
    hasHeal && healInfo.applied && healInfo.applied < healInfo.total
      ? `<div class="v-sub">Применено: ${healInfo.applied}</div>`
      : "";
  const boxes = [
    hasAttack
      ? renderCollapsibleBox({
        label: "Атака",
        value: atkRoll.successes,
        roll: atkRoll,
      })
      : null,
    hasDamage
      ? renderCollapsibleBox({
        label: "Урон",
        value: damageInfo.total,
        detailHtml: dmgFormula,
      })
      : null,
    hasHeal
      ? renderCollapsibleBox({
        label: "Хил",
        value: healInfo.total,
        detailHtml: healFormula,
        extraHtml: healExtra,
      })
      : null,
  ]
    .filter(Boolean)
    .join("");
  const headerBits = [];
  if (hasAttack && attrKey) {
    headerBits.push(`Атрибут: ${prettyAttrLabel(attrKey)}`);
  }
  if (showContest && contestCasterAttr) {
    const label = `Состязание: ${prettyAttrLabel(contestCasterAttr)} vs ${prettyAttrLabel(
      contestTargetAttr,
    )}`;
    const withSuccesses =
      Number.isFinite(contestCasterSuccesses) && contestCasterSuccesses >= 0
        ? `${label} · успехи кастера: ${contestCasterSuccesses}`
        : label;
    headerBits.push(withSuccesses);
  }

  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--attack vitruvium-chatcard--ability">
    <div class="v-head">
      <div class="v-title">${escapeHtml(attackerName)} использует ${escapeHtml(
    abilityName,
  )} → ${escapeHtml(defenderLabel)}</div>
      ${headerBits.length ? `<div class="v-sub">${headerBits.join(" · ")}</div>` : ""}
    </div>

    <div class="v-two">
      ${boxes}
    </div>

    ${showDefense
      ? renderDefenseTargets({
        defenseTargets,
        resolvedDefenderUuids,
        resolvedResults,
        predictedDamage: (damageInfo?.total ?? 0)
      })
      : ""
    }
    ${showContest
      ? renderContestTargets({
        contestTargets,
        resolvedContestDefenderUuids,
      })
      : ""
    }
  </div>`;
}

function defenseCardTwoCols({
  defenderName,
  reactionLabel,
  defRoll,
  hit = null,
  damage = 0,
  defenderTokenUuid = "",
  margin = 0,
  compact = "",
}) {
  const marginLabel = margin > 0 ? ` <span class="v-margin-badge">+${margin}</span>` : "";
  const dmgDetail = compact ? `<div class="v-sub">${compact}</div>` : "";
  const resultBox =
    hit === null
      ? `<div class="v-box">
        <div class="v-box__label">Расчёт...</div>
        <div class="v-box__big">—</div>
      </div>`
      : hit
        ? renderCollapsibleBox({
          label: `Урон${marginLabel}`,
          value: damage,
          detailHtml: dmgDetail,
        })
        : `<div class="v-box">
        <div class="v-box__label">Результат</div>
        <div class="v-box__big" style="font-size:18px;">Miss</div>
      </div>`;

  const applyBtn = ``;

  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--defense">
    <div class="v-head">
      <div class="v-title">${escapeHtml(defenderName)} — защита</div>
      <div class="v-sub">Действие: <b>${escapeHtml(reactionLabel)}</b></div>
    </div>
    <div class="v-two">
      ${renderCollapsibleBox({ label: "Защита", value: defRoll.successes, roll: defRoll })}
      ${resultBox}
    </div>
    ${applyBtn}
  </div>`;
}

function contestRollCardTwoCols({
  casterName,
  defenderName,
  casterAttr,
  defenderAttr,
  casterSuccesses,
  defRoll,
}) {
  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--defense">
    <div class="v-head">
      <div class="v-title">${escapeHtml(defenderName)} — сопротивление</div>
      <div class="v-sub">${escapeHtml(casterName)} (${escapeHtml(
    prettyAttrLabel(casterAttr),
  )}) vs ${escapeHtml(prettyAttrLabel(defenderAttr))}</div>
    </div>

    <div class="v-two">
      ${renderCollapsibleBox({ label: "Кастер", value: toNumber(casterSuccesses, 0) })}
      ${renderCollapsibleBox({ label: "Цель", value: defRoll.successes, roll: defRoll })}
    </div>
  </div>`;
}

function resolveContestCardHTML({
  attackerName,
  defenderName,
  abilityName,
  stateName,
  casterSuccesses,
  targetSuccesses,
  applied,
  defRoll = null,
}) {
  const tail = applied
    ? `Состояние <b>${escapeHtml(stateName)}</b> наложено`
    : "Цель устояла — состояние не наложено";
  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--resolve">
    <div class="v-head">
      <div class="v-title">${escapeHtml(defenderName)} — сопротивление</div>
      <div class="v-sub">${escapeHtml(attackerName)} · ${escapeHtml(abilityName)}</div>
    </div>
    <div class="v-two">
      ${renderCollapsibleBox({ label: "Кастер", value: toNumber(casterSuccesses, 0) })}
      ${renderCollapsibleBox({ label: "Цель", value: toNumber(targetSuccesses, 0), roll: defRoll })}
    </div>
    <div class="v-sub" style="margin-top:8px;">${tail}</div>
  </div>`;
}

function resolveCardHTML({
  attackerName,
  defenderName,
  weaponName,
  hit,
  damage,
  atkS,
  defS,
  compactLine,
}) {
  const statusText = hit ? "Hit" : "Miss";
  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--resolve">
    <div class="v-head">
      <div class="v-title">Результат</div>
      <div class="v-sub">${escapeHtml(attackerName)} → ${escapeHtml(defenderName)} · ${escapeHtml(
    weaponName,
  )} → ${statusText} · Урон ${damage}</div>
    </div>
    <div class="v-actions">
      <button type="button" class="v-btn v-btn--danger" data-action="vitruvium-apply-damage">Применить урон</button>
    </div>
  </div>`;
}

function resolveAbilityCardHTML({
  attackerName,
  defenderName,
  abilityName,
  damage,
  damageCompact,
  hasDamage,
}) {
  const parts = [];
  if (hasDamage) {
    parts.push(`Урон ${damage}`);
    if (damageCompact) parts.push(damageCompact);
  }
  const tail = parts.length ? ` · ${parts.join(" · ")}` : "";
  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--resolve">
    <div class="v-head">
      <div class="v-title">Результат способности</div>
      <div class="v-sub">${escapeHtml(attackerName)} → ${escapeHtml(defenderName)} · ${escapeHtml(
    abilityName,
  )}${tail}</div>
    </div>
    ${hasDamage
      ? `<div class="v-actions">
      <button type="button" class="v-btn v-btn--danger" data-action="vitruvium-apply-damage">Применить урон</button>
    </div>`
      : ""
    }
  </div>`;
}

export async function replaceStateFromTemplate(
  defenderActor,
  templateUuid,
  durationOverrideRounds = null,
  defenderTokenUuid = null,
) {
  const templateDoc = await getStateTemplateByUuid(templateUuid);
  if (!templateDoc) return { applied: false, stateName: null };

  const oldStateIds = (defenderActor.items ?? [])
    .filter((it) => it.type === "state" && it.name === templateDoc.name)
    .map((it) => it.id);

  // Delete old states with the same name.
  // The deleteItem hook in state-duration.js will automatically clean up their icons.
  if (oldStateIds.length) {
    await defenderActor.deleteEmbeddedDocuments("Item", oldStateIds);
  }

  const sourceSystem = foundry.utils.deepClone(templateDoc.system ?? {});
  const sourceMyFlags = foundry.utils.deepClone(
    templateDoc.flags?.mySystem ?? {},
  );
  const durationTurns =
    durationOverrideRounds === null || durationOverrideRounds === undefined
      ? Math.max(0, Math.round(toNumber(sourceSystem.durationRounds, 0)))
      : Math.max(0, Math.round(toNumber(durationOverrideRounds, 0)));
  const activeCombat = game.combat?.started ? game.combat : null;
  const appliedRound = Number.isFinite(Number(activeCombat?.round))
    ? Number(activeCombat.round)
    : null;
  const appliedTurn = Number.isFinite(Number(activeCombat?.turn))
    ? Number(activeCombat.turn)
    : null;
  sourceSystem.active = true;
  sourceSystem.durationRounds = durationTurns;
  sourceSystem.durationRemaining = durationTurns;

  const createdState = await defenderActor.createEmbeddedDocuments("Item", [
    {
      name: templateDoc.name,
      type: "state",
      img: templateDoc.img ?? "icons/svg/aura.svg",
      system: sourceSystem,
      flags: {
        mySystem: {
          ...sourceMyFlags,
          turnDuration: durationTurns,
          remainingTurns: durationTurns,
          ownerActorId: defenderActor.id,
          appliedRound,
          appliedTurn,
          appliedActorId: defenderActor.id,
        },
      },
    },
  ]);

  // Note: The createItem hook in state-duration.js will automatically create the icon.

  return { applied: true, stateName: templateDoc.name };
}

/* ---------- Damage ---------- */

/* ---------- Token/Actor helpers ---------- */

async function tokenDocByUuid(uuid) {
  if (!uuid) return null;
  const doc = await fromUuid(uuid);
  return doc?.documentName === "Token" ? doc : null;
}
async function actorFromTokenUuid(uuid) {
  const tokenDoc = await tokenDocByUuid(uuid);
  return tokenDoc?.actor ?? null;
}
async function actorFromActorUuid(uuid) {
  if (!uuid) return null;
  const doc = await fromUuid(uuid);
  return doc?.documentName === "Actor" ? doc : null;
}
async function resolveCombatActor({ tokenUuid = null, actorUuid = null } = {}) {
  return (
    (await actorFromTokenUuid(tokenUuid)) ??
    (await actorFromActorUuid(actorUuid))
  );
}

function userCanDefend(defenderActor) {
  if (game.user.isGM) return true;
  const lvl = defenderActor?.ownership?.[game.user.id] ?? 0;
  return lvl >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
}

/* ---------- Inline CSS ---------- */

Hooks.once("ready", () => {
  if (game.user.isGM) {
    document.body.classList.add("is-gm");
  }

  if (!globalThis.__vitruviumGmApplySocketBound) {
    globalThis.__vitruviumGmApplySocketBound = true;
    const processedApplyReqIds = new Set();
    const onGmApplySocket = async (data) => {
      if (!game.user?.isGM) return;
      if (!data || data.type !== SOCKET_EVENT_GM_APPLY) return;
      const reqId = String(data.requestId ?? "").trim();
      if (reqId) {
        if (processedApplyReqIds.has(reqId)) return;
        processedApplyReqIds.add(reqId);
      }
      const payload = data.payload ?? {};
      await createGmApplyMessage(payload);
    };
    const nsPrimary = SOCKET_NAMESPACE_PRIMARY();
    game.socket?.on?.(nsPrimary, onGmApplySocket);
    if (nsPrimary !== SOCKET_NAMESPACE_LEGACY) {
      game.socket?.on?.(SOCKET_NAMESPACE_LEGACY, onGmApplySocket);
    }
  }

  const id = "vitruvium-chatcard-style-inline";
  if (!document.getElementById(id)) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
    .vitruvium-chatcard .v-head{margin-bottom:10px}
    .vitruvium-chatcard .v-title{font-size:16px;font-weight:700}
    .vitruvium-chatcard .v-sub{font-size:12px;opacity:.75;line-height:1.25}
    .vitruvium-chatcard .v-two{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
    .vitruvium-chatcard .v-box{border:1px solid rgba(0,0,0,.15);border-radius:10px;padding:10px;background:rgba(255,255,255,.35)}
    .vitruvium-chatcard .v-box__label{font-size:12px;opacity:.75;margin-bottom:6px}
    .vitruvium-chatcard .v-box__big{font-size:26px;font-weight:800;line-height:1}
    .vitruvium-chatcard .v-actions{display:flex;gap:10px;align-items:center;margin-top:12px}
    .vitruvium-chatcard .v-margin-badge{display:inline-block;padding:1px 7px;border-radius:999px;background:rgba(40,120,200,.85);color:#fff;font-size:11px;font-weight:800;letter-spacing:.5px;margin-left:4px;vertical-align:middle}
    .vitruvium-chatcard .v-details{margin:0}
    .vitruvium-chatcard .v-details__summary{display:flex;align-items:baseline;gap:8px;cursor:pointer;list-style:none}
    .vitruvium-chatcard .v-details__summary::-webkit-details-marker{display:none}
    .vitruvium-chatcard .v-details__summary::marker{display:none;content:""}
    .vitruvium-chatcard .v-details__summary .v-box__big{transition:color .15s}
    .vitruvium-chatcard .v-details[open] .v-details__summary .v-box__big{color:rgba(0,0,0,.6)}
    .vitruvium-chatcard .v-details__body{margin-top:8px;padding-top:6px;border-top:1px solid rgba(0,0,0,.1)}
    .v-btn--danger:not(:disabled){background:rgba(200,30,30,.1);border-color:rgba(200,30,30,.4);color:#900}
    .v-btn--danger:hover:not(:disabled){background:rgba(200,30,30,.2);border-color:rgba(200,30,30,.6)}
    .v-btn--success:not(:disabled){background:rgba(30,150,30,.1);border-color:rgba(30,150,30,.4);color:#060}
    .v-btn--success:hover:not(:disabled){background:rgba(30,150,30,.2);border-color:rgba(30,150,30,.6)}
    `;
    document.head.appendChild(style);
  }

  // GM-only: listen for contest resolve requests only
  Hooks.on("createChatMessage", async (msg) => {
    try {
      if (!game.user.isGM) return;
      const f = readCombatFlags(msg);
      if (!f || f.kind !== "resolveRequest") return;
      if (String(f.requestKind ?? "") !== "contestState") {
        // Regular attack resolve is now handled inline in the defense flow — just delete the stale request
        try {
          await msg.delete();
        } catch (e) {
          /* ignore */
        }
        return;
      }

      const defender = await resolveCombatActor({
        tokenUuid: f.defenderTokenUuid,
      });
      const attacker = await resolveCombatActor({
        tokenUuid: f.attackerTokenUuid,
        actorUuid: f.attackerActorUuid,
      });
      if (!defender || !attacker) return;

      const casterSuccesses = toNumber(f.casterContestSuccesses, 0);
      const targetSuccesses = toNumber(f.targetContestSuccesses, 0);
      let applied = targetSuccesses < casterSuccesses;
      let stateName = null;

      if (applied) {
        // Use contestStates array if available, otherwise fall back to old format
        const contestStates = Array.isArray(f.contestStates)
          ? f.contestStates
          : [];
        const statesToApply =
          contestStates.length > 0
            ? contestStates.filter((s) => s.applyMode === "targetContest")
            : [
              {
                uuid: f.contestStateUuid,
                durationRounds: f.contestStateDurationRounds,
              },
            ];

        for (const state of statesToApply) {
          if (state.uuid) {
            const out = await replaceStateFromTemplate(
              defender,
              state.uuid,
              state.durationRounds,
              f.defenderTokenUuid,
            );
            applied = !!out.applied;
            stateName = out.stateName;
          }
        }
      }

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attacker }),
        content: resolveContestCardHTML({
          attackerName: attacker.name,
          defenderName: defender.name,
          abilityName: f.weaponName ?? "Способность",
          stateName: stateName ?? "Состояние",
          casterSuccesses,
          targetSuccesses,
          applied,
        }),
        ...chatVisibilityData(),
      });

      try {
        await msg.delete();
      } catch (e) {
        /* ignore */
      }
    } catch (e) {
      console.error("Vitruvium | GM resolve hook error", e);
    }
  });
});

/* ---------- Chat bindings ---------- */

Hooks.on("renderChatMessageHTML", (message, html) => {
  try {
    const f = readCombatFlags(message);
    if (!f) return;

    // Apply healing or damage button (GM-only)
    function bindApplyButtons(container) {
      container.querySelectorAll("[data-action='vitruvium-apply-damage'], [data-action='vitruvium-apply-healing']")
        .forEach((el) => {
          const newEl = el.cloneNode(true);
          el.parentNode.replaceChild(newEl, el);

          newEl.addEventListener("click", async (ev) => {
            ev.preventDefault();
            if (!game.user.isGM) return;
            const btn = ev.currentTarget;
            const isHealing = btn.getAttribute("data-action") === "vitruvium-apply-healing";
            const containerDiv = btn.closest("div");
            const tokenUuid = String(
              btn.getAttribute("data-defender-token-uuid") ??
              f.defenderTokenUuid ??
              "",
            );
            const dmg = toNumber(btn.getAttribute("data-damage") ?? f.damage, 0);
            const multSelector = containerDiv?.querySelector("[data-role='dmg-multiplier']");
            const multiplier = toNumber(multSelector?.value ?? 1, 1);
            const finalVal = Math.floor(dmg * multiplier);

            let targetActor = null;
            if (tokenUuid) {
              targetActor = await actorFromTokenUuid(tokenUuid);
            } else {
              const t = canvas.tokens.controlled[0];
              targetActor = t?.actor;
            }

            if (!targetActor) {
              ui.notifications?.warn("Выберите токен для применения.");
              return;
            }

            const curHp = toNumber(targetActor.system?.attributes?.hp?.value, 0);
            const maxHp = toNumber(targetActor.system?.attributes?.hp?.max, 100);

            const _gmProcessor = new ActionProcessor();
            if (isHealing) {
              await _gmProcessor.process({ type: "apply_heal", actor: targetActor, value: finalVal });
              btn.textContent = `Лечение применено (+${finalVal}) ✓`;
            } else {
              await _gmProcessor.process({ type: "apply_dot", actor: targetActor, value: finalVal });
              btn.textContent = `Урон применён (-${finalVal}) ✓`;
            }

            btn.disabled = true;
            if (multSelector) multSelector.disabled = true;
          });
        });
    }

    // Apply healing or damage button (GM-only)
    if (
      f.kind === "applyDamage" ||
      f.kind === "applyHealing" ||
      f.kind === "defense" ||
      f.kind === "attack"
    ) {
      bindApplyButtons(html);
    }

    if (f.kind === "attack") {
      const resolvedResults = Array.isArray(f.resolvedResults) ? f.resolvedResults : [];
      const resolvedDefenderUuids = new Set(resolvedResults.map(r => r.uuid));
      const resolvedContestDefenderUuids = new Set(
        getResolvedContestDefenderUuids(f),
      );
      const fallbackUuid = String(f.defenderTokenUuid ?? "").trim();
      html.querySelectorAll("[data-action='vitruvium-defense']").forEach((el) => {
        const btn = el;
        const defenderTokenUuid = String(
          btn.getAttribute("data-defender-token-uuid") ?? fallbackUuid,
        ).trim();
        if (!defenderTokenUuid) return;
        const isResolved =
          f.resolved || resolvedDefenderUuids.has(defenderTokenUuid);
        const row = btn.closest("[data-defender-token-uuid]");
        if (isResolved) btn.disabled = true;
        if (row) {
          const statusEl = row.querySelector("[data-role='defense-status']");
          if (statusEl) {
            statusEl.textContent = isResolved ? "Защита уже выбрана" : "";
          }
        } else {
          if (isResolved) {
            const subEl = html.querySelector(".v-actions .v-sub");
            if (subEl) subEl.textContent = "Защита уже выбрана";
          }
        }
      });

      html.querySelectorAll("[data-action='vitruvium-contest']").forEach((el) => {
        const btn = el;
        const defenderTokenUuid = String(
          btn.getAttribute("data-defender-token-uuid") ?? fallbackUuid,
        ).trim();
        if (!defenderTokenUuid) return;
        const isResolved = resolvedContestDefenderUuids.has(defenderTokenUuid);
        if (!isResolved) return;
        btn.disabled = true;
        const row = btn.closest("[data-contest-defender-token-uuid]");
        if (row) {
          const statusEl = row.querySelector("[data-role='contest-status']");
          if (statusEl) statusEl.textContent = "Сопротивление уже выбрано";
        }
      });
    }

    // Defense button
    html.querySelectorAll("[data-action='vitruvium-defense']").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget;
        const row = btn.closest("[data-defender-token-uuid]");
        const markResolvedInUI = () => {
          btn.disabled = true;
          if (row) {
            const statusEl = row.querySelector("[data-role='defense-status']");
            if (statusEl) {
              statusEl.textContent = "Защита уже выбрана";
            }
          } else {
            const subEl = html.querySelector(".v-actions .v-sub");
            if (subEl) subEl.textContent = "Защита уже выбрана";
          }
        };

        const fresh = game.messages.get(message.id) ?? message;
        const flags = readCombatFlags(fresh) ?? {};
        if (flags.kind !== "attack") return;
        const speakerActorId = String(fresh.speaker?.actor ?? "").trim();
        const speakerActor = speakerActorId
          ? game.actors?.get(speakerActorId)
          : null;

        const defenderTokenUuid = String(
          btn.getAttribute("data-defender-token-uuid") ??
          flags.defenderTokenUuid ??
          "",
        ).trim();
        if (!defenderTokenUuid) return;

        const resolvedDefenderUuids = getResolvedDefenderUuids(flags);
        if (flags.resolved || resolvedDefenderUuids.includes(defenderTokenUuid)) {
          ui.notifications?.info("Защита уже выбрана.");
          markResolvedInUI();
          return;
        }

        const lockKey = attackResolveLockKey(message.id, defenderTokenUuid);
        if (_resolvedAttackDefenseKeys.has(lockKey)) {
          ui.notifications?.info("Защита уже обрабатывается.");
          return;
        }

        _resolvedAttackDefenseKeys.add(lockKey);
        try {
          const defender = await resolveCombatActor({
            tokenUuid: defenderTokenUuid,
          });
          const attacker = await resolveCombatActor({
            tokenUuid: flags.attackerTokenUuid,
            actorUuid: flags.attackerActorUuid ?? speakerActor?.uuid,
          });
          if (!defender || !attacker) {
            ui.notifications?.warn(
              "Не удалось определить участников атаки. Создайте атаку заново.",
            );
            return;
          }

          if (!userCanDefend(defender)) {
            ui.notifications?.warn(
              "Только владелец цели или ГМ может нажать «Защита».",
            );
            return;
          }

          const isAbility = flags.attackKind === "ability";
          const isAttackRollAbility = isAbility && flags.attackRoll === true;
          const allowDodge = isAbility ? true : !hasHeavyArmorEquipped(defender);
          const allowBlock =
            hasBlockWeaponEquipped(defender) &&
            (!isAbility || isAttackRollAbility);
          if (!allowDodge && !allowBlock) {
            ui.notifications?.warn(
              "Защита недоступна: нужен предмет с галочкой «Даёт блок» или возможность уклониться.",
            );
            return;
          }
          const choice = await defenseDialog({
            allowDodge,
            allowBlock,
            actor: defender,
          });
          if (!choice) return;

          const defenseType = choice.type; // "block" | "dodge"
          const isBlock = defenseType === "block";
          const reactionLabel = isBlock
            ? (allowDodge ? "Блок" : "Принять удар (тяж. броня)")
            : "Уклонение";

          const actionId = String(flags.actionId ?? "").trim();
          const attackKindDef = flags.attackKind ?? "weapon";

          // ── Единый путь: всегда через pipeline ───────────────────────────────
          let resolvedActionId = actionId;

          if (!resolvedActionId) {
            // Старое сообщение без actionId: создаём action на лету
            const _init = new ActionProcessor();
            const atkKind = attackKindDef === "ability" ? "ability" : "attack";
            const initOpts =
              attackKindDef === "ability"
                ? {
                  damageBase: toNumber(flags.abilityDamageValue, 0),
                  damageType: "physical",
                  needsAttackRoll: flags.attackRoll === true,
                  attackAttr: flags.atkAttrKey ?? "combat",
                  needsDefense: true,
                }
                : {
                  attackAttr: flags.atkAttrKey ?? "combat",
                  needsDefense: true,
                };
            // Для старых сообщений восстанавливаем ctx вручную
            const { ActionContext } = await import("./core/action-context.js");
            const { ActionStore } = await import("./core/action-store.js");
            const fakeCtx = new ActionContext({
              type: atkKind,
              attacker,
              defender,
              weapon: null,
              options: initOpts,
            });
            fakeCtx.computed.attackSuccesses = toNumber(flags.atkSuccesses, 0);
            fakeCtx.computed.weaponDamage = toNumber(flags.weaponDamage ?? flags.abilityDamageValue, 0);
            fakeCtx.damage.base = fakeCtx.computed.weaponDamage;
            fakeCtx.damage.parts = [{ type: "physical", value: fakeCtx.computed.weaponDamage }];
            fakeCtx.state = "await_input";
            ActionStore.set(fakeCtx.id, { ctx: fakeCtx, createdAt: Date.now(), userId: game.user.id });
            resolvedActionId = fakeCtx.id;
          }

          const _processor = new ActionProcessor();
          const resumeResult = await _processor.resumeAttack(resolvedActionId, {
            defenseType,
            defender,
            defenseOptions: {
              luck: choice.luck,
              unluck: choice.unluck,
              extraDice: choice.extraDice,
              fullMode: choice.fullMode,
            }
          });
          const defRoll = resumeResult.rolls.defense;
          const damage = resumeResult.computed.damage ?? 0;
          const hit = resumeResult.computed.hit ?? (damage > 0);
          const compact = resumeResult.computed.compact ?? "";
          const margin = resumeResult.computed.margin ?? 0;

          // ── Margin-based states ────────────────────────────────────────────────
          const marginStates = Array.isArray(flags.marginStates) ? flags.marginStates : [];
          const legacyCritStates = Array.isArray(flags.critAttackStates) ? flags.critAttackStates : [];
          const allMarginStates = [
            ...marginStates,
            ...legacyCritStates.map(s => ({ ...s, condition: s.condition || ConditionResolver.migrateApplyModeToCondition("CRIT_ATTACK") })),
          ];
          if (allMarginStates.length > 0) {
            const atkSDef2 = toNumber(flags.atkSuccesses, 0);
            const defSDef2 = defRoll?.successes ?? 0;
            const context = { atk: atkSDef2, def: defSDef2, margin };
            for (const entry of allMarginStates) {
              if (!entry?.uuid) continue;
              if (entry.condition && !ConditionResolver.checkCondition(entry.condition, context)) continue;
              await replaceStateFromTemplate(defender, entry.uuid, entry.durationRounds, defenderTokenUuid);
            }
          }

          // ── Чат-карточка защиты ───────────────────────────────────────────────
          await ChatMessage.create({
            ...chatVisibilityData(),
            speaker: ChatMessage.getSpeaker({ actor: defender }),
            content: defenseCardTwoCols({ defenderName: defender.name, reactionLabel, defRoll, hit, damage, defenderTokenUuid, margin, compact }),
            rolls: defRoll.rolls,
            flags: buildCombatFlags({ kind: "defense", defenderTokenUuid, damage, hit, margin }),
          });

          await cleanupPredictedGmApplyMessages({ attackMessageId: fresh.id, defenderTokenUuid, isHealing: false });

          if (damage > 0) {
            await createGmApplyMessage({
              title: "Бросок ведущему",
              subtitle: `${attacker.name} -> ${defender.name} · итог после защиты`,
              attackMessageId: fresh.id,
              applyPhase: "resolved",
              rows: [{ defenderTokenUuid, label: defender.name, damage, isHealing: false }],
            });
          }

          const resolvedResults = Array.isArray(flags.resolvedResults) ? flags.resolvedResults : [];
          const nextResolvedResults = [...resolvedResults, { uuid: defenderTokenUuid, damage, hit, margin }];
          const nextResolvedDefenderUuids = nextResolvedResults.map(r => r.uuid);
          const defenseTargetsFlags = getDefenseTargetsFromFlags(flags);
          const allResolved = defenseTargetsFlags.length > 0 && defenseTargetsFlags.every((t) => nextResolvedDefenderUuids.includes(t.defenderTokenUuid));

          await fresh.update({
            "flags.vitruvium.resolvedResults": nextResolvedResults,
            "flags.vitruvium.resolvedDefenderUuids": nextResolvedDefenderUuids,
            "flags.vitruvium.resolved": allResolved,
            "flags.vitruvium.resolvedBy": game.user.id,
            "flags.Vitruvium.resolvedResults": nextResolvedResults,
            "flags.Vitruvium.resolvedDefenderUuids": nextResolvedDefenderUuids,
            "flags.Vitruvium.resolved": allResolved,
            "flags.Vitruvium.resolvedBy": game.user.id,
          });

          markResolvedInUI();
        } catch (e) {
          console.error("Vitruvium | defense flow error", e);
          ui.notifications?.error(`Ошибка защиты: ${e?.message ?? e}`);
        } finally {
          _resolvedAttackDefenseKeys.delete(lockKey);
        }
      });
    });

    // State contest button
    html.querySelectorAll("[data-action='vitruvium-contest']").forEach((el) => {
      el.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget;
        const row = btn.closest("[data-contest-defender-token-uuid]");
        const markResolvedInUI = () => {
          btn.disabled = true;
          if (row) {
            const statusEl = row.querySelector("[data-role='contest-status']");
            if (statusEl) statusEl.textContent = "Сопротивление уже выбрано";
          }
        };

        const fresh = game.messages.get(message.id) ?? message;
        const flags = readCombatFlags(fresh) ?? {};
        if (flags.kind !== "attack") return;
        // Support both old contestStateUuid and new contestStates format
        const contestStates = Array.isArray(flags.contestStates)
          ? flags.contestStates
          : [];
        const hasContestStates =
          contestStates.length > 0 ||
          (flags.contestEnabled && flags.contestStateUuid);
        if (!hasContestStates) return;
        const speakerActorId = String(fresh.speaker?.actor ?? "").trim();
        const speakerActor = speakerActorId
          ? game.actors?.get(speakerActorId)
          : null;

        const defenderTokenUuid = String(
          btn.getAttribute("data-defender-token-uuid") ??
          flags.defenderTokenUuid ??
          "",
        ).trim();
        if (!defenderTokenUuid) return;

        const resolvedContestDefenderUuids =
          getResolvedContestDefenderUuids(flags);
        if (resolvedContestDefenderUuids.includes(defenderTokenUuid)) {
          ui.notifications?.info("Сопротивление уже выбрано.");
          markResolvedInUI();
          return;
        }

        const lockKey = attackResolveLockKey(
          message.id,
          defenderTokenUuid,
          "contest",
        );
        if (_resolvedAttackDefenseKeys.has(lockKey)) {
          ui.notifications?.info("Сопротивление уже обрабатывается.");
          return;
        }

        _resolvedAttackDefenseKeys.add(lockKey);
        try {
          const defender = await resolveCombatActor({
            tokenUuid: defenderTokenUuid,
          });
          const attacker = await resolveCombatActor({
            tokenUuid: flags.attackerTokenUuid,
            actorUuid: flags.attackerActorUuid ?? speakerActor?.uuid,
          });
          if (!defender || !attacker) {
            ui.notifications?.warn(
              "Не удалось определить участников. Создайте применение заново.",
            );
            return;
          }



          if (!userCanDefend(defender)) {
            ui.notifications?.warn(
              "Только владелец цели или ГМ может нажать «Сопротивление».",
            );
            return;
          }

          const choice = await contestDialog({
            actor: defender,
            defaultAttrKey: flags.contestTargetAttr,
            title: "Сопротивление состоянию",
          });
          if (!choice) return;

          const effectTotals = collectEffectTotals(defender);
          const globalMods = getGlobalRollModifiers(effectTotals);
          const attrMods = getAttributeRollModifiers(
            effectTotals,
            choice.attrKey,
          );
          const baseAttr = getEffectiveAttribute(
            defender.system?.attributes,
            choice.attrKey,
            effectTotals,
          );
          const poolVal = clamp(
            baseAttr +
            attrMods.dice +
            globalMods.dice +
            toNumber(choice.extraDice, 0),
            1,
            20,
          );
          const totalLuck = toNumber(choice.luck, 0) + globalMods.adv + attrMods.adv;
          const totalUnluck =
            toNumber(choice.unluck, 0) + globalMods.dis + attrMods.dis;
          let finalFullMode = globalMods.fullMode;
          if (finalFullMode === "normal") {
            const totalLucky = globalMods.lucky + attrMods.lucky;
            const totalUnlucky = globalMods.unlucky + attrMods.unlucky;
            if (totalLucky > totalUnlucky) finalFullMode = "adv";
            else if (totalUnlucky > totalLucky) finalFullMode = "dis";
          }
          if (finalFullMode === "normal") {
            finalFullMode = choice.fullMode;
          }



          const defRoll = await rollPool(poolVal, {
            luck: totalLuck,
            unluck: totalUnluck,
            fullMode: finalFullMode,
          });

          // Single combined contest card: roll result + outcome
          const casterSuccessesContest = toNumber(flags.casterContestSuccesses, 0);
          const targetSuccessesContest = defRoll.successes;
          let appliedContest = targetSuccessesContest < casterSuccessesContest;
          let stateNameContest = null;

          if (appliedContest) {
            // Use contestStates array if available, otherwise fall back to old format
            const statesToApply =
              contestStates.length > 0
                ? contestStates.filter((s) => s.applyMode === "targetContest")
                : [
                  {
                    uuid: flags.contestStateUuid,
                    durationRounds: flags.contestStateDurationRounds,
                  },
                ];

            for (const state of statesToApply) {
              if (state.uuid) {
                const out = await replaceStateFromTemplate(
                  defender,
                  state.uuid,
                  state.durationRounds,
                  defenderTokenUuid,
                );
                appliedContest = !!out.applied;
                stateNameContest = out.stateName;
              }
            }
          }



          const contestCard = resolveContestCardHTML({
            attackerName: attacker.name,
            defenderName: defender.name,
            abilityName: flags.weaponName ?? "Способность",
            stateName: stateNameContest ?? "Состояние",
            casterSuccesses: casterSuccessesContest,
            targetSuccesses: targetSuccessesContest,
            applied: appliedContest,
            casterAttr: flags.contestCasterAttr,
            defenderAttr: choice.attrKey,
            defRoll,
          });

          await ChatMessage.create({
            ...chatVisibilityData(),
            speaker: ChatMessage.getSpeaker({ actor: defender }),
            content: contestCard,
            rolls: defRoll.rolls,
          });

          const nextResolvedContestDefenderUuids = [
            ...new Set([...resolvedContestDefenderUuids, defenderTokenUuid]),
          ];
          await fresh.update({
            "flags.vitruvium.resolvedContestDefenderUuids":
              nextResolvedContestDefenderUuids,
            "flags.Vitruvium.resolvedContestDefenderUuids":
              nextResolvedContestDefenderUuids,
          });

          markResolvedInUI();
        } catch (e) {
          console.error("Vitruvium | contest flow error", e);
          ui.notifications?.error(`Ошибка сопротивления: ${e?.message ?? e}`);
        } finally {
          _resolvedAttackDefenseKeys.delete(lockKey);
        }
      });
    });
  } catch (e) {
    console.error("Vitruvium | renderChatMessageHTML error", e);
  }
});
/* ---------- Public API ---------- */

export async function startAbilityAttackFlow(attackerActor, abilityItem) {
  try {
    const abilityName = abilityItem?.name ?? "Способность";
    const abilityDesc = String(abilityItem?.system?.description ?? "");
    const abilityCost = clamp(
      toNumber(abilityItem?.system?.cost, 0),
      0,
      6,
    );
    const damageBase = clamp(
      toNumber(abilityItem?.system?.rollDamageBase, 0),
      0,
      99,
    );
    const healBase = clamp(toNumber(abilityItem?.system?.rollHealBase, 0), 0, 99);

    // Check and deduct inspiration cost
    const attrs = attackerActor.system?.attributes ?? {};
    const insp = attrs.inspiration ?? { value: 0, max: 6 };
    const currentInsp = toNumber(insp.value, 0);
    if (currentInsp < abilityCost) {
      ui.notifications?.warn(
        `Недостаточно вдохновения для использования способности. Требуется: ${abilityCost}, доступно: ${currentInsp}`,
      );
      return;
    }
    if (abilityCost > 0) {
      const newInsp = currentInsp - abilityCost;
      await attackerActor.update({ "system.attributes.inspiration.value": newInsp });
    }

    // Normalize contestStates array - support both old and new format
    let contestStates = Array.isArray(abilityItem?.system?.contestStates)
      ? abilityItem.system.contestStates
      : [];
    // Migrate from old single-state format
    if (contestStates.length === 0) {
      const oldUuid = String(
        abilityItem?.system?.contestStateUuid ?? "",
      ).trim();
      const oldDuration = Math.max(
        0,
        Math.round(toNumber(abilityItem?.system?.contestStateDurationRounds, 1)),
      );
      const oldMode = abilityItem?.system?.contestApplyMode ?? "targetContest";
      if (oldUuid) {
        const normalized = ConditionResolver.normalizeApplyMode(oldMode);
        contestStates = [
          {
            uuid: oldUuid,
            durationRounds: oldDuration,
            applyMode: normalized.mode,
            condition: normalized.condition,
          },
        ];
      }
    }
    // Normalize each state
    contestStates = contestStates
      .filter((s) => String(s.uuid ?? "").trim().length > 0)
      .map((s) => {
        const normalized = ConditionResolver.normalizeApplyMode(s.applyMode);
        const conditionType = String(s.conditionType ?? "").trim() || (normalized.condition?.type ?? "");
        const conditionValue = s.conditionValue !== undefined && s.conditionValue !== "" && s.conditionValue !== null
          ? Number(s.conditionValue)
          : (normalized.condition?.value ?? "");
        const condition = conditionType ? { type: conditionType, value: conditionValue } : null;
        return {
          uuid: String(s.uuid ?? "").trim(),
          durationRounds: Math.max(0, Math.round(Number(s.durationRounds ?? 1))),
          applyMode: normalized.mode,
          condition,
          conditionType,
          conditionValue,
          casterAttr: String(s.casterAttr ?? "combat").trim(),
          targetAttr: String(s.targetAttr ?? "combat").trim(),
        };
      });

    const hasDamage = damageBase > 0;
    const hasHeal = healBase > 0;
    const hasContestStates = contestStates.length > 0;
    const hasAnyPayload = hasDamage || hasHeal || hasContestStates;

    if (!hasAnyPayload) {
      ui.notifications?.warn(
        "У способности не настроены урон/хил/наложение состояния.",
      );
      return;
    }

    const attackRollEnabled = abilityItem?.system?.attackRoll === true;

    // Process "self" mode states first - apply to caster immediately
    const selfStates = contestStates.filter((s) => s.applyMode === "self");
    const appliedSelfStates = [];
    for (const state of selfStates) {
      const attackerToken = attackerActor.getActiveTokens()[0];
      const attackerTokenUuid = attackerToken?.document?.uuid;
      const out = await replaceStateFromTemplate(
        attackerActor,
        state.uuid,
        state.durationRounds,
        attackerTokenUuid,
      );
      if (out.applied) {
        appliedSelfStates.push(out.stateName ?? "Состояние");
      }
    }

    // If only "self" states and no damage/heal, post chat card with description and return
    const nonSelfStates = contestStates.filter((s) => s.applyMode !== "self");
    if (
      !hasDamage &&
      !hasHeal &&
      selfStates.length > 0 &&
      nonSelfStates.length === 0
    ) {
      await playAutomatedAnimation({
        actor: attackerActor,
        item: abilityItem,
      });

      const img = abilityItem.img ?? "icons/svg/mystery-man.svg";
      const stateLines = appliedSelfStates
        .map((name) => `<p>✓ Накладывает: <b>${escapeHtml(name)}</b></p>`)
        .join("");
      const content = `
        <div class="vitruvium-chatcard">
          <div class="vitruvium-chatcard__top">
            <img class="vitruvium-chatcard__img" src="${escapeHtml(img)}" title="${escapeHtml(abilityName)}" />
            <div class="vitruvium-chatcard__head">
              <h3>${escapeHtml(abilityName)}</h3>
              <p>${escapeHtml(attackerActor.name)} использует способность</p>
            </div>
          </div>
          ${stateLines}
          ${abilityDesc ? `<div class="vitruvium-chatcard__desc">${escapeHtml(abilityDesc).replace(/\n/g, "<br>")}</div>` : ""}
        </div>
      `;
      await ChatMessage.create({
        ...chatVisibilityData(),
        speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
        content,
      });
      return;
    }

    const selectedTargets = collectSelectedDefenseTargets();
    const defenseTargets = selectedTargets;
    // Check if any non-self states need targets
    const hasNonSelfStates = nonSelfStates.length > 0;
    const contestTargets = hasNonSelfStates ? selectedTargets : [];
    const hasDefenseTarget = defenseTargets.length > 0;
    const hasContestTarget = contestTargets.length > 0;

    if (hasNonSelfStates && !hasContestTarget) {
      ui.notifications?.warn(
        "Для наложения состояния выберите цель (таргет) перед использованием способности.",
      );
    }

    // For "targetNoCheck" states, apply to all targets immediately without rolls.
    const targetNoCheckStates = nonSelfStates.filter(
      (s) => s.applyMode === "targetNoCheck",
    );
    if (targetNoCheckStates.length > 0 && hasContestTarget) {
      for (const t of contestTargets) {
        const defender = await resolveCombatActor({
          tokenUuid: t.defenderTokenUuid,
        });
        if (defender) {
          for (const state of targetNoCheckStates) {
            await replaceStateFromTemplate(
              defender,
              state.uuid,
              state.durationRounds,
              t.defenderTokenUuid,
            );
          }
        }
      }
    }

    // Contest roll states (targetContest mode) — require caster vs target contest rolls
    const targetContestStates = nonSelfStates.filter(
      (s) => s.applyMode === "targetContest",
    );
    // Margin-based states (apply when atkSuccesses - defSuccesses >= threshold)
    const targetMarginStates = nonSelfStates.filter(
      (s) => s.applyMode === "margin",
    );
    const doContestRoll = targetContestStates.length > 0 && hasContestTarget;
    // Use caster/target attr from the first targetContest state
    const contestCasterAttr =
      targetContestStates.length > 0
        ? targetContestStates[0].casterAttr
        : "combat";
    const contestTargetAttr =
      targetContestStates.length > 0
        ? targetContestStates[0].targetAttr
        : "combat";

    const attackerToken =
      attackerActor?.getActiveTokens?.(true, true)?.[0] ??
      canvas.tokens.controlled?.[0] ??
      null;
    const attackerTokenUuid = attackerToken?.document?.uuid ?? null;
    const attackerActorUuid = attackerActor?.uuid ?? null;
    const defenderTokenUuid = selectedTargets.length
      ? selectedTargets[0].defenderTokenUuid
      : null;
    const defenderName = defenseLabel(selectedTargets);

    const effectTotals = collectEffectTotals(attackerActor);
    const globalMods = getGlobalRollModifiers(effectTotals);
    const needsAttackRoll = attackRollEnabled && (hasDamage || hasHeal);
    let atkRoll = null;
    let atkAttrKey = String(abilityItem?.system?.attackAttr ?? "combat");
    let casterContestRoll = null;
    let casterContestSuccesses = 0;
    let abilityActionId = null;

    if (needsAttackRoll || (hasDamage && hasDefenseTarget)) {
      const atkChoice = needsAttackRoll
        ? await attackDialog({ actor: attackerActor, weaponName: abilityName, defaultAttrKey: abilityItem?.system?.attackAttr })
        : null;
      if (needsAttackRoll && !atkChoice) return;
      if (atkChoice) atkAttrKey = atkChoice.attrKey;

      const processor = new ActionProcessor();

      if (hasDamage && hasDefenseTarget) {
        // Этап 6: ability с уроном → startAttack(тип="ability") → получает actionId
        const startResult = await processor.startAttack({
          type: "ability",
          attacker: attackerActor,
          options: {
            needsAttackRoll: !!atkChoice,
            attackAttr: atkAttrKey,
            luck: atkChoice?.luck,
            unluck: atkChoice?.unluck,
            fullMode: atkChoice?.fullMode,
            extraDice: atkChoice?.extraDice,
            doContestRoll,
            contestCasterAttr,
            damageBase,
            needsDefense: true,
          }
        });
        abilityActionId = startResult.actionId;
        atkRoll = startResult.preview?.attackRoll ?? null;
        casterContestSuccesses = startResult.preview?.casterContestSuccesses ?? 0;
      } else {
        // Без защиты: простой process
        const result = await processor.process({
          type: "ability",
          attacker: attackerActor,
          options: {
            needsAttackRoll: !!atkChoice,
            attackAttr: atkAttrKey,
            luck: atkChoice?.luck,
            unluck: atkChoice?.unluck,
            fullMode: atkChoice?.fullMode,
            extraDice: atkChoice?.extraDice,
            doContestRoll,
            contestCasterAttr
          }
        });
        atkRoll = result.rolls.attack;
        casterContestRoll = result.rolls.contest;
        casterContestSuccesses = result.computed.casterContestSuccesses || 0;
      }
    } else if (doContestRoll) {
      const processor = new ActionProcessor();
      const result = await processor.process({
        type: "ability",
        attacker: attackerActor,
        options: { needsAttackRoll: false, doContestRoll, contestCasterAttr }
      });
      casterContestRoll = result.rolls.contest;
      casterContestSuccesses = result.computed.casterContestSuccesses || 0;
    }

    const damageValue = damageBase;
    const healValue = healBase;
    const attackSuccesses = toNumber(atkRoll?.successes, 0);
    const damageShown = hasDamage ? damageValue + attackSuccesses : 0;
    const healShown = hasHeal ? healValue + attackSuccesses : 0;

    // Automatic healing removed - now uses GM-only button or manual application
    const healApplied = null;

    const damageInfo = {
      base: damageBase,
      total: damageShown,
    };
    const healInfo = {
      base: healBase,
      total: healShown,
      applied: healApplied,
    };

    await playAutomatedAnimation({ actor: attackerActor, item: abilityItem });

    // Show contest section only for targetContest mode with targets.
    const showContest = doContestRoll && hasContestTarget;
    const publicContent = abilityAttackCard({
      attackerName: attackerActor.name,
      defenderLabel: defenderName,
      abilityName,
      attrKey: atkAttrKey,
      atkRoll,
      damageInfo,
      healInfo,
      defenseTargets,
      resolvedResults: [],
      contestTargets: showContest ? contestTargets : [],
      resolvedContestDefenderUuids: [],
      showDefense: hasDamage || attackRollEnabled,
      showContest,
      contestCasterAttr,
      contestTargetAttr,
      contestCasterSuccesses: casterContestSuccesses,
      isAttack: attackRollEnabled,
    });

    let allRolls = [];
    if (atkRoll && atkRoll.rolls) allRolls.push(...atkRoll.rolls);
    if (
      casterContestRoll &&
      casterContestRoll !== atkRoll &&
      casterContestRoll.rolls
    ) {
      allRolls.push(...casterContestRoll.rolls);
    }
    const attackMsg = await ChatMessage.create({
      ...chatVisibilityData(),
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      content: publicContent,
      rolls: allRolls,
      flags: buildCombatFlags({
        kind: "attack",
        attackKind: "ability",
        actionId: abilityActionId ?? undefined,
        abilityDamageBase: damageBase,
        abilityDamageValue: damageValue,
        atkAttrKey: atkAttrKey,
        attackerTokenUuid,
        attackerActorUuid,
        defenderTokenUuid,
        defenderName,
        defenderTargets: selectedTargets,
        resolvedDefenderUuids: [],
        resolvedContestDefenderUuids: [],
        weaponName: abilityName,
        weaponDamage: 0,
        atkSuccesses: attackSuccesses,
        attackRoll: attackRollEnabled,
        contestEnabled: doContestRoll,
        contestStates: targetContestStates,
        marginStates: targetMarginStates,
        contestCasterAttr,
        contestTargetAttr,
        casterContestSuccesses,
      }),
    });

    const gmTargets =
      selectedTargets.length > 0
        ? selectedTargets
        : [{ defenderTokenUuid: defenderTokenUuid ?? "", defenderName }];

    if (hasDamage) {
      await createGmApplyMessage({
        title: "Бросок ведущему",
        subtitle: `${attackerActor.name} · ${abilityName} · урон`,
        attackMessageId: attackMsg?.id ?? "",
        applyPhase: "predicted",
        rows: gmTargets.map((t) => ({
          defenderTokenUuid: t.defenderTokenUuid,
          label: gmTargets.length > 1 ? t.defenderName : "",
          damage: damageShown,
          isHealing: false,
        })),
      });
    }
    if (hasHeal) {
      await createGmApplyMessage({
        title: "Бросок ведущему",
        subtitle: `${attackerActor.name} · ${abilityName} · лечение`,
        attackMessageId: attackMsg?.id ?? "",
        applyPhase: "predicted",
        rows: gmTargets.map((t) => ({
          defenderTokenUuid: t.defenderTokenUuid,
          label: gmTargets.length > 1 ? t.defenderName : "",
          damage: healShown,
          isHealing: true,
        })),
      });
    }
  } catch (e) {
    console.error("Vitruvium | startAbilityAttackFlow error", e);
    ui.notifications?.error(`Ошибка способности: ${e?.message ?? e}`);
  }
}

export async function startWeaponAttackFlow(attackerActor, weaponItem) {
  try {
    const weaponName = weaponItem?.name ?? "Оружие";
    const weaponSys = weaponItem?.system ?? {};

    // Read contest states from weapon (for margin-based effects)
    const weaponContestStates = Array.isArray(weaponSys.contestStates)
      ? weaponSys.contestStates
      : [];
    const weaponMarginStates = weaponContestStates
      .filter((s) => String(s.applyMode ?? "") === "margin")
      .map((s) => ({
        ...s,
        condition: s.conditionType === "margin"
          ? { type: "margin", value: Number(s.conditionValue ?? 2) }
          : null,
      }));

    const atkChoice = await attackDialog({
      actor: attackerActor,
      weaponName,
      defaultAttrKey: weaponItem?.system?.attackAttr,
    });
    if (!atkChoice) return;

    const defenseTargets = collectSelectedDefenseTargets();
    const hasTarget = defenseTargets.length > 0;
    const defenderActor = hasTarget
      ? (await actorFromTokenUuid(defenseTargets[0].defenderTokenUuid))
      : null;

    // ── ЭТАП 9: startAttack через pipeline ────────────────────────────────────
    const processor = new ActionProcessor();
    const { actionId, preview } = await processor.startAttack({
      attacker: attackerActor,
      defender: defenderActor,
      weapon: weaponItem,
      options: {
        attackAttr: atkChoice.attrKey,
        luck: atkChoice.luck,
        unluck: atkChoice.unluck,
        extraDice: atkChoice.extraDice,
        fullMode: atkChoice.fullMode,
      },
    });

    const atkRoll = preview.attackRoll;

    const attackerToken =
      attackerActor?.getActiveTokens?.(true, true)?.[0] ??
      canvas.tokens.controlled?.[0] ??
      null;
    const attackerTokenUuid = attackerToken?.document?.uuid ?? null;
    const attackerActorUuid = attackerActor?.uuid ?? null;

    await playAutomatedAnimation({ actor: attackerActor, item: weaponItem });

    if (!hasTarget) {
      const weaponDamage = preview.damagePreview;
      const total = weaponDamage + preview.attackSuccesses;
      await ChatMessage.create({
        ...chatVisibilityData(),
        speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
        content: `
        <div class="vitruvium-chatcard vitruvium-chatcard--attack">
          <div class="v-head">
            <div class="v-title">${escapeHtml(attackerActor.name)} — атака (без цели)</div>
            <div class="v-sub">Оружие: <b>${escapeHtml(weaponName)}</b> · Атрибут: ${escapeHtml(prettyAttrLabel(atkChoice.attrKey))}</div>
          </div>
          <div class="v-two">
            <div class="v-box">
              <div class="v-box__label">Атака</div>
              <div class="v-box__big">${preview.attackSuccesses}</div>
              ${renderModeDetailSmall(atkRoll)}
              ${renderFacesInline(chosenResults(atkRoll))}
            </div>
            <div class="v-box">
              <div class="v-box__label">Урон</div>
              <div class="v-box__big">${total}</div>
              <div class="v-sub">${weaponDamage} + ${preview.attackSuccesses} = ${total}</div>
            </div>
          </div>
        </div>`,
        rolls: atkRoll.rolls,
      });
      return;
    }

    const defenderTokenUuid = defenseTargets[0].defenderTokenUuid;
    const defenderName = defenseLabel(defenseTargets);

    // Public attack message (always includes defense button)
    const weaponDamage = preview.damagePreview;
    const predictedDmgValue = weaponDamage + preview.attackSuccesses;
    const publicContent = attackCardTwoCols({
      attackerName: attackerActor.name,
      defenderLabel: defenderName,
      weaponName: weaponName,
      attrKey: atkChoice.attrKey,
      atkRoll,
      damageInfo: { base: weaponDamage, total: predictedDmgValue },
      defenseTargets,
      resolvedResults: [],
    });

    const attackMsg = await ChatMessage.create({
      ...chatVisibilityData(),
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      content: publicContent,
      rolls: atkRoll.rolls,
      flags: buildCombatFlags({
        kind: "attack",
        attackKind: "weapon",
        actionId,
        attackerTokenUuid,
        attackerActorUuid,
        defenderTokenUuid,
        defenderName,
        defenderTargets: defenseTargets,
        resolvedDefenderUuids: [],
        weaponName,
        weaponDamage,
        atkAttrKey: atkChoice.attrKey,
        atkLuck: atkRoll.luck,
        atkUnluck: atkRoll.unluck,
        atkFullMode: atkRoll.fullMode,
        atkSuccesses: preview.attackSuccesses,
        atkPool: atkRoll.pool,
        marginStates: weaponMarginStates,
      }),
    });

    await createGmApplyMessage({
      title: "Бросок ведущему",
      subtitle: `${attackerActor.name} · ${weaponName} · прогноз урона`,
      attackMessageId: attackMsg?.id ?? "",
      applyPhase: "predicted",
      rows: defenseTargets.map((t) => ({
        defenderTokenUuid: t.defenderTokenUuid,
        label: defenseTargets.length > 1 ? t.defenderName : "",
        damage: predictedDmgValue,
        isHealing: false,
      })),
    });
  } catch (e) {
    console.error("Vitruvium | startWeaponAttackFlow error", e);
    ui.notifications?.error(`Ошибка атаки: ${e?.message ?? e}`);
  }
}

export { rollPool };
