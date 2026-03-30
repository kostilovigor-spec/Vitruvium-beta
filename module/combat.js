import { playAutomatedAnimation } from "./auto-animations.js";
import {
  normalizeEffects,
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
import { showFloatingText } from "./floating-text.js";

// Vitruvium combat.js — v13 (chat-button flow, GM resolve via createChatMessage hook)
// Goal: Players must NEVER see the "Результат" card with "Применить урон".
// Defender client posts a GM-only "resolveRequest" message.
// GM client listens to createChatMessage for that flag and posts Resolve (GM-only).
// Attack and defense cards follow current core chat roll mode.

function dvSuccesses(face) {
  const v = Number(face);
  if (!Number.isFinite(v)) return 0;
  if (v <= 3) return 0;
  if (v <= 5) return 1;
  return 2; // 6
}

function dvFaceKind(face) {
  const v = Number(face);
  if (!Number.isFinite(v)) return "blank";
  if (v <= 3) return "blank";
  if (v <= 5) return "single";
  return "double";
}

function renderFacesInline(results = []) {
  const arr = Array.isArray(results) ? results : [];
  if (!arr.length) return "";
  const iconBlank = "–";
  const iconSingle = "♦";
  const iconDouble = "♦♦";
  const parts = arr.map((v) => {
    const kind = dvFaceKind(v);
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

async function rollDieOnce(roller) {
  if (typeof roller === "function") {
    const custom = await roller();
    const result = Number(custom?.result ?? custom);
    return {
      roll: custom?.roll ?? null,
      result: Number.isFinite(result) ? result : 1,
    };
  }

  const roll = new Roll("1dV");
  await roll.evaluate();
  const result = roll.dice?.[0]?.results?.[0]?.result ?? 1;
  return { roll, result: Number(result) };
}

function pickIndex(results, preferHighest) {
  let idx = 0;
  for (let i = 1; i < results.length; i++) {
    if (preferHighest) {
      if (results[i] > results[idx]) idx = i;
    } else if (results[i] < results[idx]) {
      idx = i;
    }
  }
  return idx;
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

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}
function num(v, d) {
  const x = Number(v);
  return Number.isNaN(x) ? d : x;
}
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

async function rollPool(pool, mode = "normal") {
  pool = clamp(num(pool, 1), 1, 20);
  const opts = typeof mode === "object" && mode ? mode : {};
  const roller = typeof opts.roller === "function" ? opts.roller : null;
  const dieRoller =
    typeof opts.dieRoller === "function" ? opts.dieRoller : null;
  const fullMode = String(opts.fullMode ?? "normal");
  let luck = clamp(Math.round(num(opts.luck, 0)), 0, 20);
  let unluck = clamp(Math.round(num(opts.unluck, 0)), 0, 20);

  const rollOnce = async () => {
    if (roller) {
      const custom = await roller(pool);
      const results = Array.isArray(custom?.results)
        ? custom.results.map((v) => Number(v))
        : [];
      const successes = Number.isFinite(custom?.successes)
        ? custom.successes
        : results.reduce((acc, v) => acc + dvSuccesses(v), 0);
      return {
        roll: custom?.roll ?? null,
        results,
        successes,
      };
    }

    const roll = new Roll(`${pool}dV`);
    await roll.evaluate();
    const results = (roll.dice?.[0]?.results ?? []).map((r) =>
      Number(r.result),
    );
    let successes = 0;
    for (const v of results) successes += dvSuccesses(v);
    return { roll, results, successes };
  };

  if (fullMode === "adv" || fullMode === "dis") {
    const a = await rollOnce();
    const b = await rollOnce();
    const chosen =
      fullMode === "adv"
        ? b.successes > a.successes
          ? b
          : a
        : b.successes < a.successes
          ? b
          : a;
    return {
      pool,
      successes: chosen.successes,
      rolls: [a.roll, b.roll],
      results: chosen.results,
      luck: 0,
      unluck: 0,
      fullMode,
    };
  }

  const diff = luck - unluck;
  if (diff > 0) {
    luck = diff;
    unluck = 0;
  } else if (diff < 0) {
    unluck = Math.abs(diff);
    luck = 0;
  }
  luck = Math.min(luck, pool);
  unluck = Math.min(unluck, pool);

  const base = await rollOnce();
  const roll = base.roll;
  const results = Array.isArray(base.results) ? base.results : [];
  const rolls = roll ? [roll] : [];
  const rerolls = [];

  const applyReroll = async (index, preferHigher) => {
    const before = results[index];
    const rr = await rollDieOnce(dieRoller);
    const after = rr.result;
    const chosen = preferHigher
      ? Math.max(before, after)
      : Math.min(before, after);
    results[index] = chosen;
    if (rr.roll) rolls.push(rr.roll);
    return { index, before, after, chosen };
  };

  for (let i = 0; i < luck; i++) {
    const idx = pickIndex(results, false);
    rerolls.push({ kind: "luck", ...(await applyReroll(idx, true)) });
  }
  for (let i = 0; i < unluck; i++) {
    const idx = pickIndex(results, true);
    rerolls.push({ kind: "unluck", ...(await applyReroll(idx, false)) });
  }

  let successes = 0;
  for (const v of results) successes += dvSuccesses(v);

  return {
    pool,
    successes,
    rolls,
    results,
    luck,
    unluck,
    fullMode: "normal",
    rerolls,
  };
}

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
  return allowed.filter((k) => typeof attrs[k] === "number");
}

function getWeaponDamage(actor, weaponItem = null) {
  if (weaponItem) return clamp(num(weaponItem.system?.attackBonus, 0), 0, 99);
  let best = 0;
  for (const it of actor.items ?? []) {
    if (it.type !== "item") continue;
    if (!it.system?.equipped) continue;
    best = Math.max(best, num(it.system.attackBonus ?? 0, 0));
  }
  return best;
}

function getWeaponRollMods(weaponItem) {
  const effects = normalizeEffects(weaponItem?.system?.effects);
  const totals = {};
  for (const eff of effects) {
    totals[eff.key] = (totals[eff.key] ?? 0) + num(eff.value, 0);
  }
  return getLuckModifiers(totals, {
    signedKey: "weaponLuck",
    advKey: "weaponAdv",
    disKey: "weaponDis",
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
  for (const it of actor.items ?? []) {
    if (it.type !== "item") continue;
    if (!it.system?.equipped) continue;
    if (it.system?.canBlock) return true;
  }
  return false;
}

function getArmorTotal(actor, { includeShield = true } = {}) {
  const base = num(actor.system?.attributes?.armor, 0);
  let bonus = 0;
  for (const it of actor.items ?? []) {
    if (it.type !== "item") continue;
    if (!it.system?.equipped) continue;
    const isShield = !!it.system?.isShield;
    if (!includeShield && isShield) continue;
    bonus += clamp(num(it.system.armorBonus, 0), 0, 6);
  }
  return base + bonus;
}

/* ---------- Dialogs ---------- */

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
        `<option value="${k}" ${k === defaultKey ? "selected" : ""}>${esc(
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
              luck: clamp(num(html.find("input[name='luck']").val(), 0), 0, 20),
              unluck: clamp(
                num(html.find("input[name='unluck']").val(), 0),
                0,
                20,
              ),
              extraDice: clamp(
                num(html.find("input[name='extraDice']").val(), 0),
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
            luck: clamp(num(html.find("input[name='luck']").val(), 0), 0, 20),
            unluck: clamp(
              num(html.find("input[name='unluck']").val(), 0),
              0,
              20,
            ),
            extraDice: clamp(
              num(html.find("input[name='extraDice']").val(), 0),
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
            luck: clamp(num(html.find("input[name='luck']").val(), 0), 0, 20),
            unluck: clamp(
              num(html.find("input[name='unluck']").val(), 0),
              0,
              20,
            ),
            extraDice: clamp(
              num(html.find("input[name='extraDice']").val(), 0),
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
        <div>${
          allowDodge && allowBlock
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
        `<option value="${k}" ${k === defaultKey ? "selected" : ""}>${esc(
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
            <option value="normal" ${
              defaultFullMode === "normal" ? "selected" : ""
            }>Обычный</option>
            <option value="adv" ${
              defaultFullMode === "adv" ? "selected" : ""
            }>Удачливый (полный переброс)</option>
            <option value="dis" ${
              defaultFullMode === "dis" ? "selected" : ""
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
              luck: clamp(num(html.find("input[name='luck']").val(), 0), 0, 20),
              unluck: clamp(
                num(html.find("input[name='unluck']").val(), 0),
                0,
                20,
              ),
              extraDice: clamp(
                num(html.find("input[name='extraDice']").val(), 0),
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
  weaponDamage,
  defenseTargets = [],
  resolvedDefenderUuids = [],
}) {
  const wdmg = num(weaponDamage, 0);
  const atkSucc = num(atkRoll?.successes, 0);
  const predictedDamage = Math.max(0, wdmg + atkSucc);
  const dmgFormula = `<div class="v-sub">${wdmg} (оружие) + ${atkSucc} (успехи) = ${predictedDamage}</div>`;
  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--attack">
    <div class="v-head">
      <div class="v-title">${esc(attackerName)} атакует ${esc(
        defenderLabel,
      )}</div>
      <div class="v-sub">Оружие: <b>${esc(weaponName)}</b> · Атрибут: ${esc(
        prettyAttrLabel(attrKey),
      )}</div>
    </div>

    <div class="v-two">
      ${renderCollapsibleBox({ label: "Атака", value: atkRoll.successes, roll: atkRoll })}
      ${renderCollapsibleBox({ label: "Урон", value: predictedDamage, detailHtml: dmgFormula })}
    </div>
    ${renderDefenseTargets({ defenseTargets, resolvedDefenderUuids })}
  </div>`;
}

function renderDefenseTargets({
  defenseTargets = [],
  resolvedDefenderUuids = [],
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
      return `
      <div data-defender-token-uuid="${esc(
        norm.defenderTokenUuid,
      )}" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;">
        <div class="v-sub"><b>${esc(norm.defenderName)}</b></div>
        <button type="button" class="v-btn" data-action="vitruvium-defense" data-defender-token-uuid="${esc(
          norm.defenderTokenUuid,
        )}" ${isResolved ? "disabled" : ""}>Защита</button>
        <div class="v-sub" data-role="defense-status" style="grid-column:1 / -1;">${
          isResolved ? resolvedHint : hint
        }</div>
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
      <div data-contest-defender-token-uuid="${esc(
        norm.defenderTokenUuid,
      )}" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;">
        <div class="v-sub"><b>${esc(norm.defenderName)}</b></div>
        <button type="button" class="v-btn" data-action="vitruvium-contest" data-defender-token-uuid="${esc(
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

function abilityAttackCard({
  attackerName,
  defenderLabel,
  abilityName,
  attrKey,
  atkRoll,
  damageInfo,
  healInfo,
  defenseTargets = [],
  resolvedDefenderUuids = [],
  contestTargets = [],
  resolvedContestDefenderUuids = [],
  showDefense = true,
  showContest = false,
  contestCasterAttr = null,
  contestTargetAttr = null,
  contestCasterSuccesses = null,
}) {
  const hasAttack = !!atkRoll;
  const hasDamage = !!damageInfo && damageInfo.base > 0;
  const hasHeal = !!healInfo && healInfo.base > 0;
  const atkSucc = num(atkRoll?.successes, 0);
  const dmgFormula = hasDamage
    ? `<div class="v-sub">${damageInfo.base} (способность) + ${atkSucc} (успехи) = ${damageInfo.total}</div>`
    : "";
  const healFormula = hasHeal
    ? `<div class="v-sub">${healInfo.base} (способность) + ${atkSucc} (успехи) = ${healInfo.total}</div>`
    : "";
  const healExtra =
    hasHeal && healInfo.applied < healInfo.total
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
      <div class="v-title">${esc(attackerName)} использует ${esc(
        abilityName,
      )} → ${esc(defenderLabel)}</div>
      ${headerBits.length ? `<div class="v-sub">${headerBits.join(" · ")}</div>` : ""}
    </div>

    <div class="v-two">
      ${boxes}
    </div>

    ${
      showDefense
        ? renderDefenseTargets({ defenseTargets, resolvedDefenderUuids })
        : ""
    }
    ${
      showContest
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
  crit = false,
  compact = "",
}) {
  const critBadge = crit ? ' <span class="v-crit-badge">КРИТ!</span>' : "";
  const dmgDetail = compact ? `<div class="v-sub">${compact}</div>` : "";
  const resultBox =
    hit === null
      ? `<div class="v-box">
        <div class="v-box__label">Расчёт...</div>
        <div class="v-box__big">—</div>
      </div>`
      : hit
        ? renderCollapsibleBox({
            label: `Урон${critBadge}`,
            value: damage,
            detailHtml: dmgDetail,
            extraClass: crit ? "v-box--crit" : "",
          })
        : `<div class="v-box">
        <div class="v-box__label">Результат</div>
        <div class="v-box__big" style="font-size:18px;">Miss</div>
      </div>`;

  const applyBtn =
    hit && damage > 0
      ? `<div class="v-actions gm-only" style="display:flex;align-items:center;gap:4px;">
        <select data-role="dmg-multiplier" style="height:28px;border-radius:4px;border:1px solid #999;padding:0 4px;width:auto;flex:0 0 auto;">
          <option value="0.5">×0.5</option>
          <option value="1" selected>×1</option>
          <option value="1.5">×1.5</option>
          <option value="2">×2</option>
        </select>
        <button type="button" class="v-btn v-btn--danger" data-action="vitruvium-apply-damage" data-defender-token-uuid="${esc(defenderTokenUuid)}" data-damage="${damage}" style="flex:1;">Применить урон (${damage})</button>
      </div>`
      : ``;

  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--defense">
    <div class="v-head">
      <div class="v-title">${esc(defenderName)} — защита</div>
      <div class="v-sub">Действие: <b>${esc(reactionLabel)}</b></div>
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
      <div class="v-title">${esc(defenderName)} — сопротивление</div>
      <div class="v-sub">${esc(casterName)} (${esc(
        prettyAttrLabel(casterAttr),
      )}) vs ${esc(prettyAttrLabel(defenderAttr))}</div>
    </div>

    <div class="v-two">
      ${renderCollapsibleBox({ label: "Кастер", value: num(casterSuccesses, 0) })}
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
    ? `Состояние <b>${esc(stateName)}</b> наложено`
    : "Цель устояла — состояние не наложено";
  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--resolve">
    <div class="v-head">
      <div class="v-title">${esc(defenderName)} — сопротивление</div>
      <div class="v-sub">${esc(attackerName)} · ${esc(abilityName)}</div>
    </div>
    <div class="v-two">
      ${renderCollapsibleBox({ label: "Кастер", value: num(casterSuccesses, 0) })}
      ${renderCollapsibleBox({ label: "Цель", value: num(targetSuccesses, 0), roll: defRoll })}
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
      <div class="v-sub">${esc(attackerName)} → ${esc(defenderName)} · ${esc(
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
      <div class="v-sub">${esc(attackerName)} → ${esc(defenderName)} · ${esc(
        abilityName,
      )}${tail}</div>
    </div>
    ${
      hasDamage
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

  // Удаляем старые Active Effects, связанные с этими состояниями
  if (oldStateIds.length) {
    const oldEffects =
      defenderActor.effects?.filter((ef) =>
        oldStateIds.some((id) => ef.origin?.includes(id)),
      ) || [];
    if (oldEffects.length > 0) {
      await defenderActor.deleteEmbeddedDocuments(
        "ActiveEffect",
        oldEffects.map((ef) => ef.id),
      );
    }
    await defenderActor.deleteEmbeddedDocuments("Item", oldStateIds);
  }

  const sourceSystem = foundry.utils.deepClone(templateDoc.system ?? {});
  const duration =
    durationOverrideRounds === null || durationOverrideRounds === undefined
      ? Math.max(0, Math.round(num(sourceSystem.durationRounds, 0)))
      : Math.max(0, Math.round(num(durationOverrideRounds, 0)));
  sourceSystem.active = true;
  sourceSystem.durationRounds = duration;
  sourceSystem.durationRemaining = duration;

  const createdState = await defenderActor.createEmbeddedDocuments("Item", [
    {
      name: templateDoc.name,
      type: "state",
      img: templateDoc.img ?? "icons/svg/aura.svg",
      system: sourceSystem,
    },
  ]);

  // Создаём Active Effect с иконкой состояния для отображения на токене
  if (createdState?.[0]) {
    const stateItem = createdState[0];
    await defenderActor.createEmbeddedDocuments("ActiveEffect", [
      {
        name: templateDoc.name,
        label: templateDoc.name,
        icon: templateDoc.img ?? "icons/svg/aura.svg",
        origin: stateItem.uuid,
        duration: {
          rounds: duration,
        },
        // Эффект не меняет характеристики, просто отображает иконку
        changes: [],
        disabled: false,
      },
    ]);
  }

  // Показываем всплывающий текст с названием состояния
  if (defenderTokenUuid && canvas) {
    const tokenDoc = await fromUuid(defenderTokenUuid);
    if (tokenDoc?.object) {
      showFloatingText(tokenDoc.object, 0, templateDoc.name);
    }
  }

  return { applied: true, stateName: templateDoc.name };
}

/* ---------- Damage ---------- */

function isCriticalHit(atk, def) {
  return atk >= 2 && atk >= 2 * def && atk - def >= 2;
}

function computeDamageCompact({
  weaponDamage,
  atkS,
  defS,
  defenseType,
  armorFull,
  armorNoShield,
}) {
  const atk = num(atkS, 0);
  const def = num(defS, 0);
  const base = num(weaponDamage, 0);

  // Блок:
  // 1) База: урон оружия, срезанный блоком.
  // 2) Пролом: если атака выше блока, разница добавляется отдельно.
  // 3) Бонус: успехи атаки, срезанные броней.
  // Пролом не уменьшается броней.
  if (defenseType === "block") {
    const armorVal = num(armorFull, 0);
    const bonusAtk = Math.max(0, atk - armorVal);
    const blockBonusEnabled = false;
    const blockBonusMinArmor = 2;
    const blockBonusValue = 1;
    const blockBonus =
      blockBonusEnabled && armorVal >= blockBonusMinArmor ? blockBonusValue : 0;
    const effBlock = Math.max(0, def + blockBonus);
    const baseAfter = Math.max(0, base - effBlock);
    const breakthrough = Math.max(0, atk - effBlock);
    const dmg = baseAfter + breakthrough + bonusAtk;
    const crit = isCriticalHit(atk, def);
    const finalDmg = crit ? dmg * 2 : dmg;
    const blockLabel = blockBonus ? `${def}+${blockBonus}` : `${def}`;
    const formula = `max(0, ${base} - ${blockLabel}) + max(0, ${atk} - ${blockLabel}) + max(0, ${atk} - ${armorFull})`;
    const compact = crit
      ? `(${formula}) × 2 [КРИТ] = ${finalDmg}`
      : `${formula} = ${dmg}`;
    return { damage: finalDmg, compact, hit: true, crit };
  }

  const hit = atk > def;
  if (!hit) {
    return {
      damage: 0,
      compact: `промах: ${atk} <= ${def} -> 0`,
      hit: false,
      crit: false,
    };
  }

  const armorBase = num(armorNoShield, 0);
  const effAtk = Math.max(0, atk - armorBase);
  const dmg = base + effAtk;
  const crit = isCriticalHit(atk, def);
  const finalDmg = crit ? dmg * 2 : dmg;
  const formula = `${base} + max(0, ${atk} - ${armorNoShield})`;
  const compact = crit
    ? `(${formula}) × 2 [КРИТ] = ${finalDmg}`
    : `${formula} = ${dmg}`;
  return { damage: finalDmg, compact, hit: true, crit };
}

function computeAbilityDamage({ abilityValue, atkS, defS }) {
  const base = num(abilityValue, 0);
  const atk = num(atkS, 0);
  const def = num(defS, 0);
  const hit = atk > def;
  const total = base + atk;
  const dmg = hit ? Math.max(0, total) : 0;
  const crit = hit ? isCriticalHit(atk, def) : false;
  const finalDmg = crit ? dmg * 2 : dmg;
  const formula = `${base} + ${atk}`;
  const compact = hit
    ? crit
      ? `(${formula}) × 2 [КРИТ] = ${finalDmg}`
      : `${formula} = ${dmg}`
    : `промах: ${atk} <= ${def} -> 0`;
  return { damage: finalDmg, compact, hit, crit, atkS: atk, defS: def };
}

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
    .vitruvium-chatcard .v-box--crit{border-color:rgba(200,30,30,.5);background:rgba(255,220,220,.45)}
    .vitruvium-chatcard .v-crit-badge{display:inline-block;padding:1px 7px;border-radius:999px;background:rgba(200,30,30,.85);color:#fff;font-size:11px;font-weight:800;letter-spacing:.5px;margin-left:4px;vertical-align:middle}
    .vitruvium-chatcard .v-details{margin:0}
    .vitruvium-chatcard .v-details__summary{display:flex;align-items:baseline;gap:8px;cursor:pointer;list-style:none}
    .vitruvium-chatcard .v-details__summary::-webkit-details-marker{display:none}
    .vitruvium-chatcard .v-details__summary::marker{display:none;content:""}
    .vitruvium-chatcard .v-details__summary .v-box__big{transition:color .15s}
    .vitruvium-chatcard .v-details[open] .v-details__summary .v-box__big{color:rgba(0,0,0,.6)}
    .vitruvium-chatcard .v-details__body{margin-top:8px;padding-top:6px;border-top:1px solid rgba(0,0,0,.1)}
    `;
    document.head.appendChild(style);
  }

  // GM-only: listen for contest resolve requests only
  Hooks.on("createChatMessage", async (msg) => {
    try {
      if (!game.user.isGM) return;
      const f = msg.flags?.vitruvium ?? null;
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

      const casterSuccesses = num(f.casterContestSuccesses, 0);
      const targetSuccesses = num(f.targetContestSuccesses, 0);
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
              defenderTokenUuid,
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
  const f = message.flags?.vitruvium ?? null;
  if (!f) return;

  // Apply damage button (GM-only whisper message with kind=applyDamage)
  if (f.kind === "applyDamage") {
    html
      .querySelectorAll("[data-action='vitruvium-apply-damage']")
      .forEach((el) => {
        el.addEventListener("click", async (ev) => {
          ev.preventDefault();
          if (!game.user.isGM) return;
          const btn = ev.currentTarget;
          const container = btn.closest("div");
          const tokenUuid = String(
            btn.getAttribute("data-defender-token-uuid") ??
              f.defenderTokenUuid ??
              "",
          );
          const dmg = num(btn.getAttribute("data-damage") ?? f.damage, 0);
          const multiplier = num(
            container.querySelector("[data-role='dmg-multiplier']")?.value ?? 1,
            1,
          );
          const finalDmg = Math.floor(dmg * multiplier);
          const actor = await actorFromTokenUuid(tokenUuid);
          if (!actor) return;
          const cur = num(actor.system?.attributes?.hp?.value, 0);
          await actor.update({
            "system.attributes.hp.value": Math.max(0, cur - finalDmg),
          });
          btn.disabled = true;
          btn.textContent = `Урон применён (${finalDmg}) ✓`;
          const multEl = container.querySelector(
            "[data-role='dmg-multiplier']",
          );
          if (multEl) multEl.disabled = true;
        });
      });
    return;
  }

  if (f.kind === "attack") {
    const resolvedDefenderUuids = new Set(getResolvedDefenderUuids(f));
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
      if (!isResolved) return;
      btn.disabled = true;
      const row = btn.closest("[data-defender-token-uuid]");
      if (row) {
        const statusEl = row.querySelector("[data-role='defense-status']");
        if (statusEl) statusEl.textContent = "Защита уже выбрана";
      } else {
        const subEl = html.querySelector(".v-actions .v-sub");
        if (subEl) subEl.textContent = "Защита уже выбрана";
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
          if (statusEl) statusEl.textContent = "Защита уже выбрана";
        } else {
          const subEl = html.querySelector(".v-actions .v-sub");
          if (subEl) subEl.textContent = "Защита уже выбрана";
        }
      };

      const fresh = game.messages.get(message.id) ?? message;
      const flags = fresh.flags?.vitruvium ?? {};
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

        const effectTotals = collectEffectTotals(defender);
        const globalMods = getGlobalRollModifiers(effectTotals);
        const finalFullMode =
          globalMods.fullMode !== "normal"
            ? globalMods.fullMode
            : choice.fullMode;
        let defRoll, armorShown, reactionLabel, defenseType;
        const fullText = fullModeLabel(finalFullMode);
        if (choice.type === "block") {
          defenseType = "block";
          const attrMods = getAttributeRollModifiers(effectTotals, "condition");
          const blockLuckMods = getLuckModifiers(effectTotals, {
            signedKey: "blockLuck",
            advKey: "blockAdv",
            disKey: "blockDis",
          });
          const blockDice = getEffectValue(effectTotals, "blockDice");
          const poolVal = clamp(
            num(defender.system?.attributes?.condition, 1) +
              attrMods.dice +
              blockDice +
              num(choice.extraDice, 0),
            1,
            20,
          );
          let appliedLuck =
            (choice.luck ?? 0) +
            globalMods.adv +
            attrMods.adv +
            blockLuckMods.adv;
          let appliedUnluck =
            (choice.unluck ?? 0) +
            globalMods.dis +
            attrMods.dis +
            blockLuckMods.dis;
          const diff = appliedLuck - appliedUnluck;
          if (diff > 0) {
            appliedLuck = diff;
            appliedUnluck = 0;
          } else if (diff < 0) {
            appliedUnluck = Math.abs(diff);
            appliedLuck = 0;
          }
          appliedLuck = Math.min(appliedLuck, poolVal);
          appliedUnluck = Math.min(appliedUnluck, poolVal);
          const modeText =
            finalFullMode === "adv" || finalFullMode === "dis"
              ? fullText
              : modeLabel(appliedLuck, appliedUnluck);
          const modeSuffix = modeText === "Обычный" ? "" : ` (${modeText})`;
          const totalLuck =
            (choice.luck ?? 0) +
            globalMods.adv +
            attrMods.adv +
            blockLuckMods.adv;
          const totalUnluck =
            (choice.unluck ?? 0) +
            globalMods.dis +
            attrMods.dis +
            blockLuckMods.dis;
          defRoll = await rollPool(poolVal, {
            luck: totalLuck,
            unluck: totalUnluck,
            fullMode: finalFullMode,
          });
          armorShown = getArmorTotal(defender, { includeShield: true });
          const baseLabel = allowDodge ? "Блок" : "Принять удар (тяж. броня)";
          reactionLabel = `${baseLabel}${modeSuffix}`;
        } else {
          defenseType = "dodge";
          const attrMods = getAttributeRollModifiers(effectTotals, "movement");
          const dodgeLuckMods = getLuckModifiers(effectTotals, {
            signedKey: "dodgeLuck",
            advKey: "dodgeAdv",
            disKey: "dodgeDis",
          });
          const dodgeDice = getEffectValue(effectTotals, "dodgeDice");
          const poolVal = clamp(
            num(defender.system?.attributes?.movement, 1) +
              attrMods.dice +
              dodgeDice +
              num(choice.extraDice, 0),
            1,
            20,
          );
          let appliedLuck =
            (choice.luck ?? 0) +
            globalMods.adv +
            attrMods.adv +
            dodgeLuckMods.adv;
          let appliedUnluck =
            (choice.unluck ?? 0) +
            globalMods.dis +
            attrMods.dis +
            dodgeLuckMods.dis;
          const diff = appliedLuck - appliedUnluck;
          if (diff > 0) {
            appliedLuck = diff;
            appliedUnluck = 0;
          } else if (diff < 0) {
            appliedUnluck = Math.abs(diff);
            appliedLuck = 0;
          }
          appliedLuck = Math.min(appliedLuck, poolVal);
          appliedUnluck = Math.min(appliedUnluck, poolVal);
          const modeText =
            finalFullMode === "adv" || finalFullMode === "dis"
              ? fullText
              : modeLabel(appliedLuck, appliedUnluck);
          const modeSuffix = modeText === "Обычный" ? "" : ` (${modeText})`;
          const totalLuck =
            (choice.luck ?? 0) +
            globalMods.adv +
            attrMods.adv +
            dodgeLuckMods.adv;
          const totalUnluck =
            (choice.unluck ?? 0) +
            globalMods.dis +
            attrMods.dis +
            dodgeLuckMods.dis;
          defRoll = await rollPool(poolVal, {
            luck: totalLuck,
            unluck: totalUnluck,
            fullMode: finalFullMode,
          });
          armorShown = isAbility
            ? 0
            : getArmorTotal(defender, { includeShield: false });
          reactionLabel = `Уклонение${modeSuffix}`;
        }

        // Compute damage right here (GM may not be present instantly)
        let hit = false;
        let damage = 0;
        let compact = "";
        let crit = false;
        const attackKindDef = flags.attackKind ?? "weapon";
        const defSDef = defRoll.successes;
        const atkSDef = num(flags.atkSuccesses, 0);

        if (attackKindDef === "ability") {
          const damageValue = num(flags.abilityDamageValue, 0);
          const hasDamage = num(flags.abilityDamageBase, 0) > 0;
          const attackRollEnabled = flags.attackRoll === true;
          if (hasDamage && attackRollEnabled) {
            const dmgOut = computeAbilityDamage({
              abilityValue: damageValue,
              atkS: atkSDef,
              defS: defSDef,
            });
            damage = dmgOut.damage;
            compact = dmgOut.compact;
            hit = atkSDef > defSDef;
            crit = dmgOut.crit ?? false;
          } else if (hasDamage) {
            damage = Math.max(0, damageValue);
            compact = `${damageValue}`;
            hit = true;
          } else {
            hit = attackRollEnabled ? atkSDef > defSDef : true;
          }
        } else {
          const armorFull = getArmorTotal(defender, { includeShield: true });
          const armorNoShield = getArmorTotal(defender, {
            includeShield: false,
          });
          const dmgOut = computeDamageCompact({
            weaponDamage: num(flags.weaponDamage, 0),
            atkS: atkSDef,
            defS: defSDef,
            defenseType,
            armorFull,
            armorNoShield,
          });
          damage = dmgOut.damage;
          compact = dmgOut.compact;
          hit = dmgOut.hit;
          crit = dmgOut.crit ?? false;
        }

        // Single public defense card — contains result + GM apply-damage button
        await ChatMessage.create({
          ...chatVisibilityData(),
          speaker: ChatMessage.getSpeaker({ actor: defender }),
          content: defenseCardTwoCols({
            defenderName: defender.name,
            reactionLabel,
            defRoll,
            hit,
            damage,
            defenderTokenUuid,
            crit,
            compact,
          }),
          rolls: defRoll.rolls,
          flags: {
            vitruvium: {
              kind: "defense",
              defenderTokenUuid,
              damage,
              hit,
              crit,
            },
          },
        });

        // GM-only apply damage message
        if (hit && damage > 0) {
          const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
          await ChatMessage.create({
            content: `<div style="display:flex;align-items:center;gap:4px;padding:4px 0;">
            <select data-role="dmg-multiplier" style="height:28px;border-radius:4px;border:1px solid #999;padding:0 4px;width:auto;flex:0 0 auto;">
              <option value="0.5">×0.5</option>
              <option value="1" selected>×1</option>
              <option value="1.5">×1.5</option>
              <option value="2">×2</option>
            </select>
            <button type="button" class="v-btn v-btn--danger" data-action="vitruvium-apply-damage" data-defender-token-uuid="${esc(defenderTokenUuid)}" data-damage="${damage}" style="flex:1;">Применить урон (${damage})${crit ? " [КРИТ ×2]" : ""} → ${esc(defender.name)}</button>
          </div>`,
            whisper: gmIds,
            flags: {
              vitruvium: {
                kind: "applyDamage",
                defenderTokenUuid,
                damage,
                crit,
              },
            },
          });
        }

        const nextResolvedDefenderUuids = [
          ...new Set([...resolvedDefenderUuids, defenderTokenUuid]),
        ];
        const defenseTargets = getDefenseTargetsFromFlags(flags);
        const allResolved =
          defenseTargets.length > 0 &&
          defenseTargets.every((t) =>
            nextResolvedDefenderUuids.includes(t.defenderTokenUuid),
          );

        await fresh.update({
          "flags.vitruvium.resolvedDefenderUuids": nextResolvedDefenderUuids,
          "flags.vitruvium.resolved": allResolved,
          "flags.vitruvium.resolvedBy": game.user.id,
        });

        markResolvedInUI();
      } catch (e) {
        console.error("Vitruvium | defense flow error", e);
        ui.notifications?.error(`Ошибка защиты: ${e?.message ?? e}`);
      } finally {
        _resolvedAttackDefenseKeys.delete(lockKey);
      }
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
        const flags = fresh.flags?.vitruvium ?? {};
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
          const poolVal = clamp(
            num(defender.system?.attributes?.[choice.attrKey], 1) +
              attrMods.dice +
              num(choice.extraDice, 0),
            1,
            20,
          );
          const totalLuck = num(choice.luck, 0) + globalMods.adv + attrMods.adv;
          const totalUnluck =
            num(choice.unluck, 0) + globalMods.dis + attrMods.dis;
          const finalFullMode =
            globalMods.fullMode !== "normal"
              ? globalMods.fullMode
              : choice.fullMode;
          const defRoll = await rollPool(poolVal, {
            luck: totalLuck,
            unluck: totalUnluck,
            fullMode: finalFullMode,
          });

          // Single combined contest card: roll result + outcome
          const casterSuccessesContest = num(flags.casterContestSuccesses, 0);
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
  });
});
/* ---------- Public API ---------- */

export async function startAbilityAttackFlow(attackerActor, abilityItem) {
  try {
    const abilityName = abilityItem?.name ?? "Способность";
    const abilityDesc = String(abilityItem?.system?.description ?? "");
    const damageBase = clamp(
      num(abilityItem?.system?.rollDamageBase, 0),
      0,
      99,
    );
    const healBase = clamp(num(abilityItem?.system?.rollHealBase, 0), 0, 99);

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
        Math.round(num(abilityItem?.system?.contestStateDurationRounds, 1)),
      );
      const oldMode = ["self", "targetNoCheck", "targetContest"].includes(
        abilityItem?.system?.contestApplyMode,
      )
        ? abilityItem.system.contestApplyMode
        : "targetContest";
      if (oldUuid) {
        contestStates = [
          { uuid: oldUuid, durationRounds: oldDuration, applyMode: oldMode },
        ];
      }
    }
    // Normalize each state
    contestStates = contestStates
      .filter((s) => String(s.uuid ?? "").trim().length > 0)
      .map((s) => ({
        uuid: String(s.uuid ?? "").trim(),
        durationRounds: Math.max(0, Math.round(Number(s.durationRounds ?? 1))),
        applyMode: ["self", "targetNoCheck", "targetContest"].includes(
          s.applyMode,
        )
          ? s.applyMode
          : "targetContest",
        casterAttr: String(s.casterAttr ?? "combat").trim(),
        targetAttr: String(s.targetAttr ?? "combat").trim(),
      }));

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
    if ((hasDamage || hasHeal) && !attackRollEnabled) {
      ui.notifications?.warn("Способность не помечена как атака.");
      return;
    }

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
        // Показываем всплывающий текст, если есть токен
        if (attackerToken && canvas) {
          showFloatingText(attackerToken, 0, out.stateName ?? "Состояние");
        }
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
      const esc = (s) =>
        String(s ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      const img = abilityItem.img ?? "icons/svg/mystery-man.svg";
      const stateLines = appliedSelfStates
        .map((name) => `<p>✓ Накладывает: <b>${esc(name)}</b></p>`)
        .join("");
      const content = `
        <div class="vitruvium-chatcard">
          <div class="vitruvium-chatcard__top">
            <img class="vitruvium-chatcard__img" src="${esc(img)}" title="${esc(abilityName)}" />
            <div class="vitruvium-chatcard__head">
              <h3>${esc(abilityName)}</h3>
              <p>${esc(attackerActor.name)} использует способность</p>
            </div>
          </div>
          ${stateLines}
          ${abilityDesc ? `<div class="vitruvium-chatcard__desc">${esc(abilityDesc).replace(/\n/g, "<br>")}</div>` : ""}
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
    const defenseTargets = hasDamage ? selectedTargets : [];
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

    // Contest roll states (targetContest mode)
    const targetContestStates = nonSelfStates.filter(
      (s) => s.applyMode === "targetContest",
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
    if (needsAttackRoll) {
      const atkChoice = await attackDialog({
        actor: attackerActor,
        weaponName: abilityName,
        defaultAttrKey: abilityItem?.system?.attackAttr,
      });
      if (!atkChoice) return;
      atkAttrKey = atkChoice.attrKey;
      const attackMods = getAttackRollModifiers(effectTotals, {
        attrKey: atkChoice.attrKey,
      });
      const atkPool = clamp(
        num(attackerActor.system?.attributes?.[atkChoice.attrKey], 1) +
          attackMods.dice +
          num(atkChoice.extraDice, 0),
        1,
        20,
      );
      const totalLuck =
        num(atkChoice.luck, 0) + globalMods.adv + attackMods.adv;
      const totalUnluck =
        num(atkChoice.unluck, 0) + globalMods.dis + attackMods.dis;
      const finalFullMode =
        globalMods.fullMode !== "normal"
          ? globalMods.fullMode
          : atkChoice.fullMode;
      atkRoll = await rollPool(atkPool, {
        luck: totalLuck,
        unluck: totalUnluck,
        fullMode: finalFullMode,
      });
    }

    // Contest roll for "targetContest" states.
    let casterContestRoll = null;
    let casterContestSuccesses = 0;
    if (doContestRoll) {
      if (needsAttackRoll && atkAttrKey === contestCasterAttr && atkRoll) {
        casterContestRoll = atkRoll;
        casterContestSuccesses = num(atkRoll.successes, 0);
      } else {
        const contestAttrMods = getAttributeRollModifiers(
          effectTotals,
          contestCasterAttr,
        );
        const contestPool = clamp(
          num(attackerActor.system?.attributes?.[contestCasterAttr], 1) +
            contestAttrMods.dice,
          1,
          20,
        );
        casterContestRoll = await rollPool(contestPool, {
          luck: globalMods.adv + contestAttrMods.adv,
          unluck: globalMods.dis + contestAttrMods.dis,
          fullMode: globalMods.fullMode,
        });
        casterContestSuccesses = num(casterContestRoll?.successes, 0);
      }
    }

    const damageValue = damageBase;
    const healValue = healBase;
    const attackSuccesses = num(atkRoll?.successes, 0);
    const damageShown = hasDamage ? damageValue + attackSuccesses : 0;
    const healShown = hasHeal ? healValue + attackSuccesses : 0;

    let healApplied = 0;
    if (hasHeal) {
      const attrs = attackerActor.system?.attributes ?? {};
      const hp = attrs.hp ?? {};
      const hpMax = Math.max(
        0,
        getEffectiveAttribute(attrs, "condition", effectTotals) * 8 +
          getEffectValue(effectTotals, "hpMax"),
      );
      const hpCur = clamp(num(hp.value, hpMax), 0, hpMax);
      const hpNext = clamp(hpCur + healShown, 0, hpMax);
      healApplied = Math.max(0, hpNext - hpCur);
      if (hpNext !== hpCur) {
        await attackerActor.update({
          "system.attributes.hp.value": hpNext,
        });
      }
    }

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
      resolvedDefenderUuids: [],
      contestTargets: showContest ? contestTargets : [],
      resolvedContestDefenderUuids: [],
      showDefense: hasDefenseTarget,
      showContest,
      contestCasterAttr,
      contestTargetAttr,
      contestCasterSuccesses: casterContestSuccesses,
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
    const hasInteractiveTargets = hasDefenseTarget || showContest;
    await ChatMessage.create({
      ...chatVisibilityData(),
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      content: publicContent,
      rolls: allRolls,
      flags: hasInteractiveTargets
        ? {
            vitruvium: {
              kind: "attack",
              attackKind: "ability",
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
              contestCasterAttr,
              contestTargetAttr,
              casterContestSuccesses,
            },
          }
        : {},
    });
  } catch (e) {
    console.error("Vitruvium | startAbilityAttackFlow error", e);
    ui.notifications?.error(`Ошибка способности: ${e?.message ?? e}`);
  }
}

export async function startWeaponAttackFlow(attackerActor, weaponItem) {
  try {
    const weaponName = weaponItem?.name ?? "Оружие";
    const weaponDamage = getWeaponDamage(attackerActor, weaponItem);

    const atkChoice = await attackDialog({
      actor: attackerActor,
      weaponName,
      defaultAttrKey: weaponItem?.system?.attackAttr,
    });
    if (!atkChoice) return;

    const effectTotals = collectEffectTotals(attackerActor);
    const globalMods = getGlobalRollModifiers(effectTotals);
    const attackMods = getAttackRollModifiers(effectTotals, {
      attrKey: atkChoice.attrKey,
    });
    const atkPool = clamp(
      num(attackerActor.system?.attributes?.[atkChoice.attrKey], 1) +
        attackMods.dice +
        num(atkChoice.extraDice, 0),
      1,
      20,
    );
    const weaponMods = getWeaponRollMods(weaponItem);
    const totalLuck =
      num(atkChoice.luck, 0) + weaponMods.adv + globalMods.adv + attackMods.adv;
    const totalUnluck =
      num(atkChoice.unluck, 0) +
      weaponMods.dis +
      globalMods.dis +
      attackMods.dis;
    const finalFullMode =
      globalMods.fullMode !== "normal"
        ? globalMods.fullMode
        : atkChoice.fullMode;
    const atkRoll = await rollPool(atkPool, {
      luck: totalLuck,
      unluck: totalUnluck,
      fullMode: finalFullMode,
    });

    const defenseTargets = collectSelectedDefenseTargets();
    const hasTarget = defenseTargets.length > 0;
    const attackerToken =
      attackerActor?.getActiveTokens?.(true, true)?.[0] ??
      canvas.tokens.controlled?.[0] ??
      null;
    const attackerTokenUuid = attackerToken?.document?.uuid ?? null;
    const attackerActorUuid = attackerActor?.uuid ?? null;

    await playAutomatedAnimation({ actor: attackerActor, item: weaponItem });

    if (!hasTarget) {
      const total = Math.max(0, weaponDamage + atkRoll.successes);
      await ChatMessage.create({
        ...chatVisibilityData(),
        speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
        content: `
        <div class="vitruvium-chatcard vitruvium-chatcard--attack">
          <div class="v-head">
            <div class="v-title">${esc(
              attackerActor.name,
            )} — атака (без цели)</div>
            <div class="v-sub">Оружие: <b>${esc(
              weaponName,
            )}</b> · Атрибут: ${esc(prettyAttrLabel(atkChoice.attrKey))}</div>
          </div>
          <div class="v-two">
            <div class="v-box">
              <div class="v-box__label">Атака</div>
              <div class="v-box__big">${atkRoll.successes}</div>
              ${renderModeDetailSmall(atkRoll)}
        ${renderFacesInline(chosenResults(atkRoll))}
            </div>
            <div class="v-box">
              <div class="v-box__label">Урон</div>
              <div class="v-box__big">${total}</div>
              <div class="v-sub">${weaponDamage} + ${
                atkRoll.successes
              } = ${total}</div>
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
    const publicContent = attackCardTwoCols({
      attackerName: attackerActor.name,
      defenderLabel: defenderName,
      weaponName,
      attrKey: atkChoice.attrKey,
      atkRoll,
      weaponDamage,
      defenseTargets,
      resolvedDefenderUuids: [],
    });

    await ChatMessage.create({
      ...chatVisibilityData(),
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      content: publicContent,
      rolls: atkRoll.rolls,
      flags: {
        vitruvium: {
          kind: "attack",
          attackKind: "weapon",
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
          atkSuccesses: atkRoll.successes,
          atkPool: atkRoll.pool,
        },
      },
    });
  } catch (e) {
    console.error("Vitruvium | startWeaponAttackFlow error", e);
    ui.notifications?.error(`Ошибка атаки: ${e?.message ?? e}`);
  }
}

export { rollPool, computeDamageCompact };
