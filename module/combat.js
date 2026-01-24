import { playAutomatedAnimation } from "./auto-animations.js";
import {
  normalizeEffects,
  collectEffectTotals,
  getEffectValue,
  getGlobalRollModifiers,
} from "./effects.js";

// Vitruvium combat.js — v13 (chat-button flow, GM-resolve via createChatMessage hook)
// Goal: Players must NEVER see the "Результат" card.
// Fix: When defender clicks "Защита", their client posts a GM-whisper "resolveRequest" message.
// GM client listens to createChatMessage for that flag and posts the Resolve card (whisper to GM only).
// No sockets, no blind, no public resolve. Public remains: attack request card + defense roll card.

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

function owners(actor) {
  const list = [];
  for (const u of game.users ?? []) {
    if (u.isGM) continue;
    const lvl = actor?.ownership?.[u.id] ?? 0;
    if (lvl >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) list.push(u);
  }
  return list;
}
function isGMNPC(actor) {
  return owners(actor).length === 0;
}
function gmUsers() {
  return (game.users ?? []).filter((u) => u.isGM);
}
function gmIds() {
  return gmUsers().map((u) => u.id);
}

const _resolvedAttackMsgIds = new Set();

async function rollPool(pool, mode = "normal") {
  pool = clamp(num(pool, 1), 1, 20);
  const opts = typeof mode === "object" && mode ? mode : {};
  const roller = typeof opts.roller === "function" ? opts.roller : null;
  const dieRoller = typeof opts.dieRoller === "function" ? opts.dieRoller : null;
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
      Number(r.result)
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
    const chosen = preferHigher ? Math.max(before, after) : Math.min(before, after);
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
  let adv = 0;
  let dis = 0;
  for (const eff of effects) {
    if (eff.key === "weaponAdv") adv += clamp(num(eff.value, 0), 0, 20);
    if (eff.key === "weaponDis") dis += clamp(num(eff.value, 0), 0, 20);
  }
  return { adv, dis };
}

function hasHeavyArmorEquipped(actor) {
  for (const it of actor.items ?? []) {
    if (it.type !== "item") continue;
    if (!it.system?.equipped) continue;
    if (it.system?.isHeavyArmor) return true;
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
  const fallbackKey = keys.includes("combat") ? "combat" : keys[0] ?? "combat";
  const defaultKey = keys.includes(defaultAttrKey) ? defaultAttrKey : fallbackKey;
  const defaultLuck = 0;
  const defaultUnluck = 0;
  const defaultFullMode = "normal";
  const options = keys
    .map(
      (k) =>
        `<option value="${k}" ${k === defaultKey ? "selected" : ""}>${esc(
          prettyAttrLabel(k)
        )}</option>`
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
                20
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

function defenseDialog({ allowDodge = true, allowBlock = true, actor = null } = {}) {
  return new Promise((resolve) => {
    const defaultLuck = 0;
    const defaultUnluck = 0;
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
              20
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
              20
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
        <div style="font-size:12px; opacity:.75;">Каждый счетчик преимущества/помехи перебрасывает один куб. Удачливый/неудачливый бросок игнорирует счетчики.</div>
      </div>`,
      buttons,
      close: () => resolve(null),
    }).render(true);
  });
}

/* ---------- Cards ---------- */

function attackCardTwoCols({
  attackerName,
  defenderName,
  weaponName,
  attrKey,
  atkRoll,
  weaponDamage,
  resolved,
}) {
  const predictedDamage = Math.max(
    0,
    num(weaponDamage, 0) + num(atkRoll?.successes, 0)
  );
  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--attack">
    <div class="v-head">
      <div class="v-title">${esc(attackerName)} атакует ${esc(
    defenderName
  )}</div>
      <div class="v-sub">Оружие: <b>${esc(weaponName)}</b> · Атрибут: ${esc(
    prettyAttrLabel(attrKey)
  )}</div>
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
        <div class="v-box__big">${predictedDamage}</div>
        <div class="v-sub">Базовый урон оружия: ${weaponDamage}</div>
      </div>
    </div>

    <div class="v-actions">
      <button type="button" class="v-btn" data-action="vitruvium-defense" ${
        resolved ? "disabled" : ""
      }>Защита</button>
      <span class="v-sub">${
        resolved ? "Защита уже выбрана" : "Нажмите «Защита» владельцем цели"
      }</span>
    </div>
  </div>`;
}

function defenseRequestOnlyCard({
  attackerName,
  defenderName,
  weaponName,
  resolved,
}) {
  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--attack vitruvium-chatcard--request">
    <div class="v-head">
      <div class="v-title">${esc(attackerName)} атакует ${esc(
    defenderName
  )}</div>
      <div class="v-sub">Оружие: <b>${esc(
        weaponName
      )}</b> · <i>результаты атаки скрыты</i></div>
    </div>
    <div class="v-actions">
      <button type="button" class="v-btn" data-action="vitruvium-defense" ${
        resolved ? "disabled" : ""
      }>Защита</button>
      <span class="v-sub">${
        resolved ? "Защита уже выбрана" : "Нажмите «Защита» владельцем цели"
      }</span>
    </div>
  </div>`;
}

function abilityAttackCard({
  attackerName,
  defenderName,
  abilityName,
  attrKey,
  atkRoll,
  damageInfo,
  saveInfo,
  resolved,
  showDefense = true,
}) {
  const hasAttack = !!atkRoll;
  const hasDamage = !!damageInfo && (damageInfo.base > 0 || damageInfo.dice > 0);
  const hasSave = !!saveInfo && (saveInfo.base > 0 || saveInfo.dice > 0);
  const dmgSub = [];
  if (hasDamage && hasAttack) {
    dmgSub.push(`атака ${atkRoll.successes}`);
  }
  const boxes = [
    hasAttack
      ? `<div class="v-box">
        <div class="v-box__label">Атака</div>
        <div class="v-box__big">${atkRoll.successes}</div>
        ${renderModeDetailSmall(atkRoll)}
        ${renderFacesInline(chosenResults(atkRoll))}
      </div>`
      : null,
    hasDamage
      ? `<div class="v-box">
        <div class="v-box__label">Урон</div>
        <div class="v-box__big">${damageInfo.total}</div>
        ${dmgSub.length ? `<div class="v-sub">${dmgSub.join(" · ")}</div>` : ""}
        ${
          damageInfo.dice > 0 && damageInfo.roll
            ? `${renderModeDetailSmall(damageInfo.roll)}${renderFacesInline(
                chosenResults(damageInfo.roll)
              )}`
            : ""
        }
      </div>`
      : null,
  ]
    .filter(Boolean)
    .join("");
  const headerBits = [];
  if (hasAttack && attrKey) {
    headerBits.push(`Атрибут: ${prettyAttrLabel(attrKey)}`);
  }
  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--attack vitruvium-chatcard--ability">
    <div class="v-head">
      <div class="v-title">${esc(attackerName)} использует ${esc(
    abilityName
  )} → ${esc(defenderName)}</div>
      ${headerBits.length ? `<div class="v-sub">${headerBits.join(" · ")}</div>` : ""}
    </div>

    <div class="v-two">
      ${boxes}
    </div>
    ${hasSave ? `<div class="v-sub" style="margin-top:8px;">Сложность спасброска ${saveInfo.total}</div>` : ""}

    ${
      showDefense
        ? `<div class="v-actions">
      <button type="button" class="v-btn" data-action="vitruvium-defense" ${
        resolved ? "disabled" : ""
      }>Защита</button>
      <span class="v-sub">${
        resolved ? "Защита уже выбрана" : "Нажмите «Защита» владельцем цели"
      }</span>
    </div>`
        : ""
    }
  </div>`;
}

function abilityRequestOnlyCard({
  attackerName,
  defenderName,
  abilityName,
  damageBase,
  damageDice,
  saveBase,
  saveDice,
  saveValue,
  resolved,
}) {
  const hasDamage = damageBase > 0 || damageDice > 0;
  const hasSave = saveBase > 0 || saveDice > 0;
  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--attack vitruvium-chatcard--request">
    <div class="v-head">
      <div class="v-title">${esc(attackerName)} использует ${esc(
    abilityName
  )} → ${esc(defenderName)}</div>
      <div class="v-sub"><i>результаты скрыты</i></div>
    </div>
    ${
      hasSave
        ? `<div class="v-sub" style="margin-top:8px;">Сложность спасброска ${saveValue ?? "?"}</div>`
        : ""
    }
    <div class="v-actions">
      <button type="button" class="v-btn" data-action="vitruvium-defense" ${
        resolved ? "disabled" : ""
      }>Защита</button>
      <span class="v-sub">${
        resolved ? "Защита уже выбрана" : "Нажмите «Защита» владельцем цели"
      }</span>
    </div>
  </div>`;
}

function defenseCardTwoCols({
  defenderName,
  reactionLabel,
  defRoll,
  armorShown,
}) {
  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--defense">
    <div class="v-head">
      <div class="v-title">${esc(defenderName)} — защита</div>
      <div class="v-sub">Действие: <b>${esc(reactionLabel)}</b></div>
    </div>

    <div class="v-two">
      <div class="v-box">
        <div class="v-box__label">Защита</div>
        <div class="v-box__big">${defRoll.successes}</div>
        ${renderFacesInline(chosenResults(defRoll))}
        ${renderModeDetailSmall(defRoll)}
      </div>
      <div class="v-box">
        <div class="v-box__label">Броня</div>
        <div class="v-box__big">${armorShown}</div>
        <div class="v-sub">Учтённая в расчёте</div>
      </div>
    </div>
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
  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--resolve">
    <div class="v-head">
      <div class="v-title">Результат</div>
      <div class="v-sub">${esc(attackerName)} → ${esc(defenderName)} · ${esc(
    weaponName
  )}</div>
    </div>
    <div class="v-two">
      <div class="v-box">
        <div class="v-box__label">Статус</div>
        <div class="v-box__big">${hit ? "HIT" : "MISS"}</div>
        <div class="v-sub">Успехи: ${atkS} / ${defS}</div>
      </div>
      <div class="v-box">
        <div class="v-box__label">Итоговый урон</div>
        <div class="v-box__big">${damage}</div>
        <div class="v-sub">${esc(compactLine)}</div>
      </div>
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
  defS,
  damage,
  damageCompact,
  saveValue,
  savePassed,
  hasDamage,
  hasSave,
}) {
  const bigValue =
    hasDamage
      ? `${damage}`
      : hasSave
      ? savePassed
        ? "Спас"
        : "Не спас"
      : "—";
  const lines = [];
  if (hasSave) {
    lines.push(
      `Сложность: ${saveValue} · Защита: ${defS} · ${
        savePassed ? "Спас" : "Не спас"
      }`
    );
  }
  if (hasDamage) {
    lines.push(`Урон: ${damage}${damageCompact ? ` (${damageCompact})` : ""}`);
  }
  const detail = lines.length ? lines.join("<br>") : "—";
  return `
  <div class="vitruvium-chatcard vitruvium-chatcard--resolve">
    <div class="v-head">
      <div class="v-title">Результат способности</div>
      <div class="v-sub">${esc(attackerName)} → ${esc(defenderName)} · ${esc(
    abilityName
  )}</div>
    </div>
    <div class="v-two">
      <div class="v-box">
        <div class="v-box__label">Защита</div>
        <div class="v-box__big">${defS}</div>
        <div class="v-sub">Успехи защиты</div>
      </div>
      <div class="v-box">
        <div class="v-box__label">Итог</div>
        <div class="v-box__big">${bigValue}</div>
        <div class="v-sub">${detail}</div>
      </div>
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

/* ---------- Damage ---------- */

function computeDamageCompact({
  weaponDamage,
  atkS,
  defS,
  defenseType,
  armorFull,
  armorNoShield,
}) {
  const diff = atkS - defS;
  /*
    ВАРИАНТ A (предыдущая модель):
    Броня уменьшает и базовый урон, и разницу успехов на половину своего значения.
    Если броня > 0, половина не может быть меньше 1.

    const halfArmor = (armorVal) => {
      const base = Math.floor(num(armorVal, 0) / 2);
      if (num(armorVal, 0) <= 0) return 0;
      return Math.max(1, base);
    };

    if (defenseType === "block") {
      const armorHalf = halfArmor(armorFull);
      const baseAfter = Math.max(0, weaponDamage - armorHalf);
      const diffAfter = Math.max(0, diff - armorHalf);
      const dmg = baseAfter + diffAfter;
      const compact = `${weaponDamage} - floor(${armorFull}/2) + max(0, (${atkS}-${defS})-floor(${armorFull}/2)) = ${dmg}`;
      return { damage: dmg, compact, hit: true };
    }

    const hit = atkS > defS;
    const armorHalf = halfArmor(armorNoShield);
    const baseAfter = Math.max(0, weaponDamage - armorHalf);
    const bonus = Math.max(0, diff - armorHalf);
    const dmg = Math.max(0, baseAfter + bonus);
    const compact = `${weaponDamage} - floor(${armorNoShield}/2) + max(0, (${atkS}-${defS})-floor(${armorNoShield}/2)) = ${dmg}`;
    return { damage: dmg, compact, hit };
  */

  // ВАРИАНТ B (текущий):
  // Броня уменьшает итоговый урон: (урон оружия + разница успехов).
  // Для уклонения при промахе учитывается только половина брони (но не меньше 1).
  if (defenseType === "block") {
    const total = weaponDamage + diff;
    const dmg = Math.max(0, total - num(armorFull, 0));
    const compact = `${weaponDamage} + (${atkS}-${defS}) - ${armorFull} = ${dmg}`;
    return { damage: dmg, compact, hit: true };
  }

  const hit = atkS > defS;
  const armorBase = num(armorNoShield, 0);
  const armorHalf =
    armorBase > 0 ? Math.max(1, Math.floor(armorBase / 2)) : 0;
  const appliedArmor = hit ? armorBase : armorHalf;
  const total = weaponDamage + diff;
  const dmg = Math.max(0, total - appliedArmor);
  const armorLabel = hit ? `${armorNoShield}` : `floor(${armorNoShield}/2)`;
  const compact = `${weaponDamage} + (${atkS}-${defS}) - ${armorLabel} = ${dmg}`;
  return { damage: dmg, compact, hit };
}

function computeAbilityDamage({ abilityValue, atkS, defS }) {
  const base = num(abilityValue, 0);
  const atk = num(atkS, 0);
  const def = num(defS, 0);
  const diff = atk - def;
  const hit = atk > def;
  const total = base + diff;
  const dmg = Math.max(0, total);
  const compact = `${base} + ${atk} - ${def} = ${dmg}`;
  return { damage: dmg, compact, hit, atkS: atk, defS: def };
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
    `;
    document.head.appendChild(style);
  }

  // GM-only: listen for resolve requests and post resolve card whisper-only
  Hooks.on("createChatMessage", async (msg) => {
    try {
      if (!game.user.isGM) return;
      const f = msg.flags?.vitruvium ?? null;
      if (!f || f.kind !== "resolveRequest") return;

      const defender = await actorFromTokenUuid(f.defenderTokenUuid);
      const attacker = await actorFromTokenUuid(f.attackerTokenUuid);
      if (!defender || !attacker) return;

      const armorFull = getArmorTotal(defender, { includeShield: true });
      const armorNoShield = getArmorTotal(defender, { includeShield: false });
      const attackKind = String(f.attackKind ?? "weapon");
      const defS = num(f.defSuccesses, 0);

      let damage = 0;
      let compact = "";
      let hit = false;
      let atkS = num(f.atkSuccesses, 0);

      if (attackKind === "ability") {
        const damageValue = num(f.abilityDamageValue, 0);
        const saveValue = num(f.abilitySaveValue, 0);
        const hasDamage =
          num(f.abilityDamageBase, 0) > 0 || num(f.abilityDamageDice, 0) > 0;
        const hasSave =
          num(f.abilitySaveBase, 0) > 0 || num(f.abilitySaveDice, 0) > 0;
        const damageOut = hasDamage
          ? computeAbilityDamage({
              abilityValue: damageValue,
              atkS,
              defS,
            })
          : { damage: 0, compact: "", hit: false };
        const savePassed = hasSave ? defS >= saveValue : false;
        damage = hasDamage ? damageOut.damage : 0;
        compact = hasDamage ? damageOut.compact : "";
        hit = hasDamage ? damageOut.hit : hasSave ? !savePassed : false;

        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: attacker }),
          content: resolveAbilityCardHTML({
            attackerName: attacker.name,
            defenderName: defender.name,
            abilityName: f.weaponName ?? "Способность",
            defS,
            damage,
            damageCompact: compact,
            saveValue,
            savePassed,
            hasDamage,
            hasSave,
          }),
          whisper: gmIds(),
          flags: {
            vitruvium: {
              kind: "resolve",
              defenderTokenUuid: f.defenderTokenUuid,
              damage,
              attackKind,
            },
          },
        });

        // Remove the request message to prevent empty "side-effect" lines in chat
        try {
          await msg.delete();
        } catch (e) {
          /* ignore */
        }
        return;
      } else {
        const out = computeDamageCompact({
          weaponDamage: num(f.weaponDamage, 0),
          atkS: num(f.atkSuccesses, 0),
          defS,
          defenseType: f.defenseType,
          armorFull,
          armorNoShield,
        });
        damage = out.damage;
        compact = out.compact;
        hit = out.hit;
      }

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attacker }),
        content: resolveCardHTML({
          attackerName: attacker.name,
          defenderName: defender.name,
          weaponName: f.weaponName,
          hit,
          damage,
          atkS,
          defS,
          compactLine: compact,
        }),
        whisper: gmIds(),
        flags: {
          vitruvium: {
            kind: "resolve",
            defenderTokenUuid: f.defenderTokenUuid,
            damage,
            attackKind,
          },
        },
      });

      // Remove the request message to prevent empty "side-effect" lines in chat
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

Hooks.on("renderChatMessage", (message, html) => {
  const f = message.flags?.vitruvium ?? null;
  if (!f) return;

  if (f.kind === "attack" && f.resolved) {
    const btn = html.find("[data-action='vitruvium-defense']");
    btn.prop("disabled", true);
    html.find(".v-actions .v-sub").text("Защита уже выбрана");
  }

  // Apply damage (GM only)
  html
    .find("[data-action='vitruvium-apply-damage']")
    .on("click", async (ev) => {
      ev.preventDefault();
      if (!game.user.isGM) return;

      const flags = message.flags?.vitruvium ?? {};
      if (flags.kind !== "resolve") return;

      const defender = await actorFromTokenUuid(flags.defenderTokenUuid);
      if (!defender) return;

      const dmg = num(flags.damage, 0);
      const cur = num(defender.system?.attributes?.hp?.value, 0);
      await defender.update({
        "system.attributes.hp.value": Math.max(0, cur - dmg),
      });
      html
        .find("[data-action='vitruvium-apply-damage']")
        .prop("disabled", true);
    });

  // Defense button
  html.find("[data-action='vitruvium-defense']").on("click", async (ev) => {
    ev.preventDefault();
    const fresh = game.messages.get(message.id) ?? message;
    const flags = fresh.flags?.vitruvium ?? {};
    if (flags.kind !== "attack") return;

    if (flags.resolved) {
      ui.notifications?.info("Защита уже выбрана.");
      html.find("[data-action='vitruvium-defense']").prop("disabled", true);
      return;
    }

    if (_resolvedAttackMsgIds.has(message.id)) {
      ui.notifications?.info("Защита уже выбрана.");
      html.find("[data-action='vitruvium-defense']").prop("disabled", true);
      return;
    }

    const defender = await actorFromTokenUuid(flags.defenderTokenUuid);
    const attacker = await actorFromTokenUuid(flags.attackerTokenUuid);
    if (!defender || !attacker) return;

    if (!userCanDefend(defender)) {
      ui.notifications?.warn(
        "Только владелец цели или ГМ может нажать «Защита»."
      );
      return;
    }

    const isAbility = flags.attackKind === "ability";
    const allowDodge = isAbility ? true : !hasHeavyArmorEquipped(defender);
    const allowBlock = !isAbility;
    const choice = await defenseDialog({ allowDodge, allowBlock, actor: defender });
    if (!choice) return;

    const effectTotals = collectEffectTotals(defender);
    const globalMods = getGlobalRollModifiers(effectTotals);
    const finalFullMode =
      globalMods.fullMode !== "normal" ? globalMods.fullMode : choice.fullMode;
    let defRoll, armorShown, reactionLabel, defenseType;
    const fullText = fullModeLabel(finalFullMode);
    if (choice.type === "block") {
      defenseType = "block";
      const poolVal = num(defender.system?.attributes?.condition, 1);
      let appliedLuck = (choice.luck ?? 0) + globalMods.adv;
      let appliedUnluck = (choice.unluck ?? 0) + globalMods.dis;
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
      const totalLuck = (choice.luck ?? 0) + globalMods.adv;
      const totalUnluck = (choice.unluck ?? 0) + globalMods.dis;
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
      const poolVal = num(defender.system?.attributes?.movement, 1);
      const dodgeAdv = Math.max(0, getEffectValue(effectTotals, "dodgeAdv"));
      const dodgeDis = Math.max(0, getEffectValue(effectTotals, "dodgeDis"));
      let appliedLuck = (choice.luck ?? 0) + globalMods.adv + dodgeAdv;
      let appliedUnluck = (choice.unluck ?? 0) + globalMods.dis + dodgeDis;
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
      const totalLuck = (choice.luck ?? 0) + globalMods.adv + dodgeAdv;
      const totalUnluck = (choice.unluck ?? 0) + globalMods.dis + dodgeDis;
      defRoll = await rollPool(poolVal, {
        luck: totalLuck,
        unluck: totalUnluck,
        fullMode: finalFullMode,
      });
      armorShown = isAbility ? 0 : getArmorTotal(defender, { includeShield: false });
      reactionLabel = `Уклонение${modeSuffix}`;
    }

    // Public defense roll
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: defender }),
      content: defenseCardTwoCols({
        defenderName: defender.name,
        reactionLabel,
        defRoll,
        armorShown,
      }),
      rolls: defRoll.rolls,
    });

    // Request GM to compute resolve (whisper to GM, no blind). Players won't see.
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: defender }),
      whisper: gmIds(),
      content: "<!--vitruvium-resolve-request-->", // silent (will be deleted by GM hook)
      flags: {
        vitruvium: {
          kind: "resolveRequest",
          attackKind: flags.attackKind ?? "weapon",
          attackerTokenUuid: flags.attackerTokenUuid,
          defenderTokenUuid: flags.defenderTokenUuid,
          weaponName: flags.weaponName,
          weaponDamage: flags.weaponDamage,
          atkSuccesses: flags.atkSuccesses,
          abilityDamageBase: flags.abilityDamageBase,
          abilityDamageValue: flags.abilityDamageValue,
          abilitySaveBase: flags.abilitySaveBase,
          abilitySaveValue: flags.abilitySaveValue,
          abilityDamageDice: flags.abilityDamageDice,
          abilitySaveDice: flags.abilitySaveDice,
          defSuccesses: defRoll.successes,
          defenseType,
        },
      },
    });

    await message.update({
      "flags.vitruvium.resolved": true,
      "flags.vitruvium.resolvedBy": game.user.id,
    });

    _resolvedAttackMsgIds.add(message.id);
    html.find("[data-action='vitruvium-defense']").prop("disabled", true);
  });
});

/* ---------- Public API ---------- */

export async function startAbilityAttackFlow(attackerActor, abilityItem) {
  try {
    const abilityName = abilityItem?.name ?? "Способность";
    const damageBase = clamp(
      num(abilityItem?.system?.rollDamageBase, 0),
      0,
      99
    );
    let damageDice = clamp(num(abilityItem?.system?.rollDamageDice, 0), 0, 20);
    const saveBase = clamp(num(abilityItem?.system?.rollSaveBase, 0), 0, 99);
    let saveDice = clamp(num(abilityItem?.system?.rollSaveDice, 0), 0, 20);
    if (damageDice === 0 && saveDice === 0) {
      const legacyMode = String(abilityItem?.system?.rollMode ?? "none");
      const legacyDice = clamp(num(abilityItem?.system?.rollDice, 0), 0, 20);
      if (legacyMode === "damage") damageDice = legacyDice;
      if (legacyMode === "save") saveDice = legacyDice;
    }

    const hasDamage = damageBase > 0 || damageDice > 0;
    const hasSave = saveBase > 0 || saveDice > 0;

    if (!hasDamage && !hasSave) {
      ui.notifications?.warn("У способности не настроен бросок dV.");
      return;
    }

    const targetToken = [...game.user.targets][0];
    const hasTarget = !!targetToken?.document?.uuid && !!targetToken?.actor;

    const attackerToken =
      attackerActor?.getActiveTokens?.(true, true)?.[0] ??
      canvas.tokens.controlled?.[0] ??
      null;
    const attackerTokenUuid = attackerToken?.document?.uuid ?? null;
    const defenderTokenUuid = hasTarget ? targetToken.document.uuid : null;
    const defenderName = hasTarget
      ? targetToken.name ?? targetToken.actor.name
      : "без цели";
    const gmNpcAttack = isGMNPC(attackerActor);

    const effectTotals = collectEffectTotals(attackerActor);
    const globalMods = getGlobalRollModifiers(effectTotals);

    let atkChoice = null;
    let atkRoll = null;
    let atkAttrKey = null;
    if (hasDamage) {
      atkChoice = await attackDialog({
        actor: attackerActor,
        weaponName: abilityName,
        defaultAttrKey: abilityItem?.system?.attackAttr,
      });
      if (!atkChoice) return;
      atkAttrKey = atkChoice.attrKey;
      const atkPool = num(
        attackerActor.system?.attributes?.[atkChoice.attrKey],
        1
      );
      const totalLuck = num(atkChoice.luck, 0) + globalMods.adv;
      const totalUnluck = num(atkChoice.unluck, 0) + globalMods.dis;
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

    const finalFullMode =
      globalMods.fullMode !== "normal" ? globalMods.fullMode : "normal";

    const damageRoll =
      hasDamage && damageDice > 0
        ? await rollPool(damageDice, {
            luck: globalMods.adv,
            unluck: globalMods.dis,
            fullMode: finalFullMode,
          })
        : null;
    const saveRoll =
      hasSave && saveDice > 0
        ? await rollPool(saveDice, {
            luck: globalMods.adv,
            unluck: globalMods.dis,
            fullMode: finalFullMode,
          })
        : null;
    const damageValue = (damageRoll?.successes ?? 0) + damageBase;
    const saveValue = (saveRoll?.successes ?? 0) + saveBase;
    const attackSuccesses = atkRoll?.successes ?? 0;
    const damageInfo = {
      base: damageBase,
      dice: damageDice,
      roll: damageRoll,
      total: damageValue,
    };
    const saveInfo = {
      base: saveBase,
      dice: saveDice,
      roll: saveRoll,
      total: saveValue,
    };

    await playAutomatedAnimation({ actor: attackerActor, item: abilityItem });

    const showPublicResults = !gmNpcAttack || !hasTarget;
    const publicContent = showPublicResults
      ? abilityAttackCard({
          attackerName: attackerActor.name,
          defenderName,
          abilityName,
          attrKey: atkAttrKey,
          atkRoll,
          damageInfo,
          saveInfo,
          resolved: false,
          showDefense: hasTarget,
        })
      : abilityRequestOnlyCard({
          attackerName: attackerActor.name,
          defenderName,
          abilityName,
          damageBase,
          damageDice,
          saveBase,
          saveDice,
          saveValue,
          resolved: false,
        });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      content: publicContent,
      rolls: gmNpcAttack
        ? []
        : [
            ...(atkRoll?.rolls ?? []),
            ...(damageRoll?.rolls ?? []),
            ...(saveRoll?.rolls ?? []),
          ],
      flags: hasTarget
        ? {
            vitruvium: {
              kind: "attack",
              attackKind: "ability",
              abilityDamageBase: damageBase,
              abilityDamageDice: damageDice,
              abilitySaveBase: saveBase,
              abilitySaveDice: saveDice,
              abilityDamageValue: damageValue,
              abilitySaveValue: saveValue,
              atkAttrKey: atkAttrKey,
              attackerTokenUuid,
              defenderTokenUuid,
              weaponName: abilityName,
              weaponDamage: 0,
              atkSuccesses: attackSuccesses,
              gmNpcAttack,
            },
          }
        : {},
    });

    if (gmNpcAttack && hasTarget) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
        whisper: gmIds(),
        content: abilityAttackCard({
          attackerName: attackerActor.name,
          defenderName,
          abilityName,
          attrKey: atkAttrKey,
          atkRoll,
          damageInfo,
          saveInfo,
          resolved: true,
          showDefense: false,
        }),
        rolls: [
          ...(atkRoll?.rolls ?? []),
          ...(damageRoll?.rolls ?? []),
          ...(saveRoll?.rolls ?? []),
        ],
        flags: { vitruvium: { kind: "gm-ability-detail" } },
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
    const weaponDamage = getWeaponDamage(attackerActor, weaponItem);

    const atkChoice = await attackDialog({
      actor: attackerActor,
      weaponName,
      defaultAttrKey: weaponItem?.system?.attackAttr,
    });
    if (!atkChoice) return;

    const atkPool = num(
      attackerActor.system?.attributes?.[atkChoice.attrKey],
      1
    );
    const effectTotals = collectEffectTotals(attackerActor);
    const globalMods = getGlobalRollModifiers(effectTotals);
    const weaponMods = getWeaponRollMods(weaponItem);
    const totalLuck = num(atkChoice.luck, 0) + weaponMods.adv + globalMods.adv;
    const totalUnluck =
      num(atkChoice.unluck, 0) + weaponMods.dis + globalMods.dis;
    const finalFullMode =
      globalMods.fullMode !== "normal" ? globalMods.fullMode : atkChoice.fullMode;
    const atkRoll = await rollPool(atkPool, {
      luck: totalLuck,
      unluck: totalUnluck,
      fullMode: finalFullMode,
    });

    const targetToken = [...game.user.targets][0];
    const attackerToken = canvas.tokens.controlled?.[0] ?? null;
    const attackerTokenUuid = attackerToken?.document?.uuid ?? null;

    await playAutomatedAnimation({ actor: attackerActor, item: weaponItem });

    if (!targetToken?.document?.uuid || !targetToken?.actor) {
      const total = Math.max(0, weaponDamage + atkRoll.successes);
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
        content: `
        <div class="vitruvium-chatcard vitruvium-chatcard--attack">
          <div class="v-head">
            <div class="v-title">${esc(
              attackerActor.name
            )} — атака (без цели)</div>
            <div class="v-sub">Оружие: <b>${esc(
              weaponName
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

    const defenderTokenUuid = targetToken.document.uuid;
    const defenderName = targetToken.name ?? targetToken.actor.name;
    const gmNpcAttack = isGMNPC(attackerActor);

    // Public attack message (always includes defense button)
    const publicContent = gmNpcAttack
      ? defenseRequestOnlyCard({
          attackerName: attackerActor.name,
          defenderName,
          weaponName,
          resolved: false,
        })
      : attackCardTwoCols({
          attackerName: attackerActor.name,
          defenderName,
          weaponName,
          attrKey: atkChoice.attrKey,
          atkRoll,
          weaponDamage,
          resolved: false,
        });

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      content: publicContent,
      rolls: gmNpcAttack ? [] : atkRoll.rolls,
      flags: {
        vitruvium: {
          kind: "attack",
          attackerTokenUuid,
          defenderTokenUuid,
          weaponName,
          weaponDamage,
          atkAttrKey: atkChoice.attrKey,
          atkLuck: atkRoll.luck,
          atkUnluck: atkRoll.unluck,
          atkFullMode: atkRoll.fullMode,
          atkSuccesses: atkRoll.successes,
          atkPool: atkRoll.pool,
          gmNpcAttack,
        },
      },
    });

    // GM-only detailed attack (optional): whisper only, no rolls (avoid leakage)
    if (gmNpcAttack) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
        whisper: gmIds(),
        content: attackCardTwoCols({
          attackerName: attackerActor.name,
          defenderName,
          weaponName,
          attrKey: atkChoice.attrKey,
          atkRoll,
          weaponDamage,
          resolved: true,
        }),
        rolls: [],
        flags: { vitruvium: { kind: "gm-attack-detail" } },
      });
    }
  } catch (e) {
    console.error("Vitruvium | startWeaponAttackFlow error", e);
    ui.notifications?.error(`Ошибка атаки: ${e?.message ?? e}`);
  }
}

export { rollPool, computeDamageCompact };

