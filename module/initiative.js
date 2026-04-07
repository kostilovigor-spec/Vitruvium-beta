// systems/Vitruvium/module/initiative.js
import {
  collectEffectTotals,
  getAttributeRollModifiers,
  getGlobalRollModifiers,
} from "./effects.js";
import { chatVisibilityData } from "./chat-visibility.js";
import { DiceSystem } from "./core/dice-system.js";

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}
function num(v, d) {
  const x = Number(v);
  return Number.isNaN(x) ? d : x;
}

function successesIcons(n) {
  return Array.from({ length: Math.max(0, n) }, () => "◆").join(" ");
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

/** Обёртка над DiceSystem.rollPool с поддержкой Dice So Nice через onRoll */
function rollPool(pool, opts = {}) {
  return DiceSystem.rollPool(pool, {
    ...opts,
    onRoll: game.dice3d
      ? (r) => game.dice3d.showForRoll(r, game.user, true)
      : undefined,
  });
}

async function luckRollShow(actorName, targetName) {
  const r = await rollPool(1);
  const s = r.successes; // 0,1,2
  const ok = s > 0;
  const content = `
    <div class="v-card v-card--luck">
      <div class="v-card__header">
        <div class="v-card__title">☾ ${actorName} — Бросок удачи (тай-брейк против ${targetName})</div>
      </div>
      <div class="v-card__row">
        <div class="v-card__label">Результат</div>
        <div class="v-card__value"><b>${ok ? "Успех" : "Провал"}</b></div>
      </div>
    </div>
  `;
  await ChatMessage.create({ ...chatVisibilityData(), content });
  return ok;
}

function isPC(combatant) {
  const a = combatant.actor;
  if (!a) return false;
  // PC = есть владелец-игрок или тип character
  return a.hasPlayerOwner || a.type === "character";
}

export async function vitruviumRollInitiative(combat, ids, rollOpts = {}) {
  const rollIds = Array.isArray(ids)
    ? ids
    : ids !== null && ids !== undefined
      ? [ids]
      : [];
  const updates = [];
  const chatLines = [];

  const luck = clamp(num(rollOpts.luck, 0), 0, 20);
  const unluck = clamp(num(rollOpts.unluck, 0), 0, 20);
  const fullMode = String(rollOpts.fullMode ?? "normal");
  const fullText = fullModeLabel(fullMode);
  const modeText =
    fullMode === "adv" || fullMode === "dis"
      ? fullText
      : modeLabel(luck, unluck);
  const modeTag = modeText === "Обычный" ? "" : ` (${modeText})`;

  for (const id of rollIds) {
    const c = combat.combatants.get(id);
    const a = c?.actor;
    if (!c || !a) continue;

    const effectTotals = collectEffectTotals(a);
    const movementMods = getAttributeRollModifiers(effectTotals, "movement");
    const globalMods = getGlobalRollModifiers(effectTotals);
    const baseMovement = num(
      a.system?.attributes?.movement?.value ?? a.system?.attributes?.movement,
      1
    );
    const move = clamp(
      clamp(baseMovement, 1, 6) +
      movementMods.dice +
      globalMods.dice,
      1,
      20
    );
    const totalLuck = luck + globalMods.adv + movementMods.adv;
    const totalUnluck = unluck + globalMods.dis + movementMods.dis;
    const finalFullMode =
      globalMods.fullMode !== "normal" ? globalMods.fullMode : fullMode;
    let appliedLuck = totalLuck;
    let appliedUnluck = totalUnluck;
    const diff = appliedLuck - appliedUnluck;
    if (diff > 0) {
      appliedLuck = diff;
      appliedUnluck = 0;
    } else if (diff < 0) {
      appliedUnluck = Math.abs(diff);
      appliedLuck = 0;
    }
    appliedLuck = Math.min(appliedLuck, move);
    appliedUnluck = Math.min(appliedUnluck, move);
    const lineModeText =
      finalFullMode === "adv" || finalFullMode === "dis"
        ? fullModeLabel(finalFullMode)
        : modeLabel(appliedLuck, appliedUnluck);
    const lineModeTag = lineModeText === "Обычный" ? "" : ` (${lineModeText})`;

    const r1 = await rollPool(move, {
      luck: totalLuck,
      unluck: totalUnluck,
      fullMode: finalFullMode,
    });
    const s1 = r1.successes;

    // initiative = число успехов (пока без тай-брейка)
    updates.push({ _id: id, initiative: s1 });

    chatLines.push(
      `<div><b>${c.name}</b>: Движение ${move}${lineModeTag} - успехи: <b>${s1}</b> ${successesIcons(s1)}</div>`
    );
  }

  // обновляем инициативу разом
  if (updates.length)
    await combat.updateEmbeddedDocuments("Combatant", updates);

  // Тай-брейк:
  // делаем лёгкий сдвиг новых участников для правильной сортировки Foundry
  await vitruviumResolvePcNpcTies(combat, rollIds);

  // Сообщение в чат о бросках
  const head =
    modeText === "Обычный"
      ? "Инициатива (Движение)"
      : `Инициатива (Движение, ${modeText})`;
  const content = `
    <div class="v-card v-card--attr">
      <div class="v-card__header">
        <div class="v-card__title">? ${head}</div>
      </div>
      <div class="v-card__row">
        <div class="v-card__label">Результаты</div>
        <div class="v-card__value">${chatLines.join("")}</div>
      </div>
      <div class="v-card__footer">
        <span class="v-rule">При равенстве PC-NPC: бросок удачи игрока решает порядок</span>
      </div>
    </div>
  `;
  await ChatMessage.create({ ...chatVisibilityData(), content });
}

async function vitruviumResolvePcNpcTies(combat, rollIds) {
  const rollIdSet = new Set(rollIds || []);
  if (!rollIdSet.size) return;

  // группируем по базовой инициативе (целой части)
  const groups = new Map(); // key: integer initiative, val: combatants[]
  for (const c of combat.combatants) {
    if (c.initiative === null || c.initiative === undefined) continue;
    const base = Math.trunc(Number(c.initiative));
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(c);
  }

  const tieUpdates = [];

  for (const [base, list] of groups.entries()) {
    if (list.length < 2) continue;

    const rollers = list.filter((c) => rollIdSet.has(c.id));
    if (!rollers.length) continue;

    const existing = list.filter((c) => !rollIdSet.has(c.id));

    let currentMin = base;
    let currentMax = base;
    if (existing.length > 0) {
      const inits = existing.map((c) => Number(c.initiative));
      currentMin = Math.min(...inits);
      currentMax = Math.max(...inits);
    }

    const allNPCs = list.filter((c) => !isPC(c));

    // Сначала обрабатываем NPC, потом PC, чтобы при одновременном броске
    // PC мог сделать бросок против уже размещенного NPC.
    rollers.sort((a, b) => {
      const aPC = isPC(a);
      const bPC = isPC(b);
      if (aPC === bPC) return 0;
      return aPC ? 1 : -1;
    });

    for (const c of rollers) {
      let newInit = base;

      if (isPC(c) && allNPCs.length > 0) {
        // PC против NPC: бросок удачи
        const ok = await luckRollShow(c.name, "NPC");
        if (ok) {
          currentMax += 0.01;
          newInit = currentMax;
        } else {
          currentMin -= 0.01;
          newInit = currentMin;
        }
      } else {
        // NPC или PC без конфликта с NPC: просто идет после всех
        // Если это первый участник в пустой группе, оставляем ему base.
        if (existing.length === 0 && newInit === currentMin) {
          existing.push(c); // Теперь группа не пуста для следующих
        } else {
          currentMin -= 0.01;
          newInit = currentMin;
        }
      }

      newInit = Number(newInit.toFixed(4));
      tieUpdates.push({ _id: c.id, initiative: newInit });
      // Обновляем локально, чтобы следующие броски учитывали сдвиг
      c.initiative = newInit;
    }
  }

  if (tieUpdates.length)
    await combat.updateEmbeddedDocuments("Combatant", tieUpdates);
}

export function patchVitruviumInitiative() {
  const SOCKET_EVENT = "vitruvium-roll-initiative";
  const SOCKET_NAMESPACE_PRIMARY = () => `system.${game.system.id}`;
  const SOCKET_NAMESPACE_LEGACY = "system.vitruvium";
  const processedRequestIds = new Set();
  const handleSocketRequest = async (data) => {
    try {
      if (!game.user?.isGM) return;
      if (!data || data.type !== SOCKET_EVENT) return;
      const requestId = String(data.requestId ?? "").trim();
      if (requestId) {
        if (processedRequestIds.has(requestId)) return;
        processedRequestIds.add(requestId);
      }
      const combatId = String(data.combatId ?? "").trim();
      if (!combatId) return;
      const combat = game.combats?.get(combatId);
      if (!combat) return;
      const ids = Array.isArray(data.ids) ? data.ids : [];
      const rollOpts = data.rollOpts ?? {};
      const updateTurn = data.updateTurn !== false;
      await vitruviumRollInitiative(combat, ids, rollOpts);
      if (updateTurn) await combat.update({ turn: 0 });
    } catch (e) {
      console.error("Vitruvium | initiative socket error", e);
    }
  };
  if (!globalThis.__vitruviumInitiativeSocketBound) {
    globalThis.__vitruviumInitiativeSocketBound = true;
    Hooks.once("ready", () => {
      if (!game.socket) return;
      const nsPrimary = SOCKET_NAMESPACE_PRIMARY();
      game.socket.on(nsPrimary, handleSocketRequest);
      if (nsPrimary !== SOCKET_NAMESPACE_LEGACY) {
        game.socket.on(SOCKET_NAMESPACE_LEGACY, handleSocketRequest);
      }
    });
  }

  // подменяем стандартную rollInitiative
  const original = Combat.prototype.rollInitiative;

  Combat.prototype.rollInitiative = async function (
    ids,
    { updateTurn = true } = {}
  ) {
    // ids может быть undefined => роллим всех
    const rollIds = Array.isArray(ids)
      ? ids
      : ids !== null && ids !== undefined
        ? [ids]
        : this.combatants.map((c) => c.id);

    const choice = await new Promise((resolve) => {
      new Dialog({
        title: "Vitruvium: Инициатива",
        content: `<div style="display:grid; gap:8px;">
          <div>Как бросать инициативу (Движение)?</div>
          <label>Удачливый бросок
            <select name="fullMode" style="width:100%">
              <option value="normal">Обычный</option>
              <option value="adv">Удачливый (полный переброс)</option>
              <option value="dis">Неудачливый (полный переброс)</option>
            </select>
          </label>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <label>Преимущество
              <input type="number" name="luck" value="0" min="0" max="20" step="1" style="width:100%"/>
            </label>
            <label>Помеха
              <input type="number" name="unluck" value="0" min="0" max="20" step="1" style="width:100%"/>
            </label>
          </div>
          <div style="font-size:12px; opacity:.75;">Каждый счетчик преимущества/помехи перебрасывает один куб. Удачливый/неудачливый бросок игнорирует счетчики.</div>
        </div>`,
        buttons: {
          roll: {
            label: "Бросить",
            callback: (html) =>
              resolve({
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

    if (!choice) return this;

    if (!game.user?.isGM) {
      try {
        await vitruviumRollInitiative(this, rollIds, choice);
        if (updateTurn) await this.update({ turn: 0 });
      } catch (_err) {
        const requestId =
          foundry?.utils?.randomID?.() ??
          `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const payload = {
          type: SOCKET_EVENT,
          requestId,
          combatId: this.id,
          ids: rollIds,
          rollOpts: choice,
          updateTurn,
          userId: game.user?.id,
        };
        const nsPrimary = SOCKET_NAMESPACE_PRIMARY();
        game.socket?.emit?.(nsPrimary, payload);
        if (nsPrimary !== SOCKET_NAMESPACE_LEGACY) {
          game.socket?.emit?.(SOCKET_NAMESPACE_LEGACY, payload);
        }
      }
      return this;
    }

    await vitruviumRollInitiative(this, rollIds, choice);

    if (updateTurn) await this.update({ turn: 0 });
    return this;
  };

  // на всякий случай сохраним оригинал, если захочешь вернуть
  Combat.prototype.rollInitiative._vitruviumOriginal = original;
}



