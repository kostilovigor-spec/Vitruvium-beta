// systems/Vitruvium/module/combat.js
// Vitruvium combat flow: targeted attacks with attacker dialog + defender reaction via socket.
// - Attack attribute: combat OR thinking (select in dialog)
// - Attack mode: normal/adv/dis (buttons)
// - Defender reaction: dodge (movement, normal/adv/dis) OR block (condition/resistance, always hit)
// - Hit if atkSuccess > defSuccess (for dodge). Block always hit.
// - Damage = weaponDamage + (atkSuccess - defSuccess) - armorTotal, min 0
// - Applies HP reduction on defender.

const SOCKET_CHANNEL = "system.Vitruvium";
const DEF_REQ = "vitruvium-defense-request";
const DEF_RES = "vitruvium-defense-response";

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

/** Roll a pool of d6 using Vitruvium success rules; supports normal/adv/dis. */
async function rollPool(pool, mode = "normal") {
  pool = clamp(num(pool, 1), 1, 20);

  const doOne = async () => {
    const roll = await new Roll(`${pool}d6`).evaluate({ async: true });
    const results = roll.dice?.[0]?.results?.map((r) => r.result) ?? [];

    let successes = 0;
    for (const r of results) {
      if (r <= 3) continue;
      if (r <= 5) successes += 1;
      else successes += 2; // 6 = 2 успеха
    }
    return { roll, results, successes };
  };

  if (mode === "normal") {
    const a = await doOne();
    return {
      mode,
      pool,
      chosen: a,
      other: null,
      successes: a.successes,
      rolls: [a.roll],
    };
  }

  const a = await doOne();
  const b = await doOne();

  const chosen =
    mode === "adv"
      ? a.successes >= b.successes
        ? a
        : b
      : a.successes <= b.successes
      ? a
      : b;

  const other = chosen === a ? b : a;

  return {
    mode,
    pool,
    chosen,
    other,
    successes: chosen.successes,
    rolls: [a.roll, b.roll],
  };
}

/** Sum equipped armor bonuses + base armor attribute. */
function getArmorTotal(actor) {
  const attrs = actor?.system?.attributes ?? {};
  const base = num(attrs.armor, 0);

  let bonus = 0;
  const clamp6 = (n) => clamp(num(n, 0), 0, 6);

  for (const it of actor.items ?? []) {
    if (it.type !== "item") continue;
    const sys = it.system ?? {};
    if (!sys.equipped) continue;
    bonus += clamp6(sys.armorBonus);
  }

  return { base, bonus, total: base + bonus };
}

/** Weapon damage = max damage among equipped items; fallback to actor.attributes.attack. */
function getWeaponDamage(actor) {
  let best = 0;
  for (const it of actor.items ?? []) {
    if (it.type !== "item") continue;
    const sys = it.system ?? {};
    if (!sys.equipped) continue;
    const dmg = num(sys.damage, 0);
    if (dmg > best) best = dmg;
  }
  if (best > 0) return best;

  const attrs = actor?.system?.attributes ?? {};
  return num(attrs.attack, 0);
}

/** Find an active owner for the defender actor (not current user). */
function findActiveOwner(defenderActor) {
  return game.users.find(
    (u) =>
      u.active &&
      u.id !== game.user.id &&
      defenderActor.testUserPermission(u, "OWNER")
  );
}

function modeLabel(mode) {
  if (mode === "adv") return "с преимуществом";
  if (mode === "dis") return "с помехой";
  return "обычная";
}

async function postAttackChat({
  attacker,
  defender,
  atkAttrLabel,
  atkMode,
  defType,
  defMode,
  atkRoll,
  defRoll,
  hit,
  weaponDamage,
  armorTotal,
  damage,
}) {
  const atkS = atkRoll.successes;
  const defS = defRoll ? defRoll.successes : 0;

  const defLine =
    defType === "block"
      ? `Защита: Блок (сопротивление, попадание всегда)`
      : `Защита: Уклонение (${modeLabel(defMode)})`;

  const content = `
    <div class="vitruvium-chatcard">
      <h3>${esc(attacker.name)} атакует ${esc(defender.name)}</h3>
      <p class="hint">Атака: ${esc(atkAttrLabel)} (${modeLabel(atkMode)}) · ${esc(
    defLine
  )}</p>

      <p><b>Успехи атаки:</b> ${atkS}</p>
      <p><b>Успехи защиты:</b> ${defS}</p>

      <hr>

      ${
        hit
          ? `<p><b>ПОПАДАНИЕ.</b> Урон оружия ${weaponDamage} + (${atkS} − ${defS}) − броня ${armorTotal} = <b>${damage}</b></p>`
          : `<p><b>ПРОМАХ.</b> (${atkS} ≤ ${defS})</p>`
      }
    </div>
  `;

  const rolls = [];
  if (atkRoll?.rolls?.length) rolls.push(...atkRoll.rolls);
  if (defRoll?.rolls?.length) rolls.push(...defRoll.rolls);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    content,
    rolls,
  });
}

/** Dialog: attacker chooses attack attribute (combat/thinking) and mode (normal/adv/dis). */
function attackDialog() {
  return new Promise((resolve) => {
    const content = `
      <div class="v-dialog">
        <div style="margin-bottom:10px;">
          <label>
            Атрибут атаки:
            <select name="attr" style="width:100%; margin-top:6px;">
              <option value="combat">Сражение</option>
              <option value="thinking">Мышление</option>
            </select>
          </label>
        </div>
        <p class="hint">Выберите режим атаки:</p>
      </div>
    `;

    new Dialog({
      title: "Атака",
      content,
      buttons: {
        normal: {
          label: "Обычная",
          callback: (html) => {
            const key = String(html.find("select[name='attr']").val() ?? "combat");
            resolve({
              attrKey: key,
              attrLabel: key === "thinking" ? "Мышление" : "Сражение",
              mode: "normal",
            });
          },
        },
        dis: {
          label: "С помехой",
          callback: (html) => {
            const key = String(html.find("select[name='attr']").val() ?? "combat");
            resolve({
              attrKey: key,
              attrLabel: key === "thinking" ? "Мышление" : "Сражение",
              mode: "dis",
            });
          },
        },
        adv: {
          label: "С преимуществом",
          callback: (html) => {
            const key = String(html.find("select[name='attr']").val() ?? "combat");
            resolve({
              attrKey: key,
              attrLabel: key === "thinking" ? "Мышление" : "Сражение",
              mode: "adv",
            });
          },
        },
      },
      default: "normal",
      close: () => resolve(null),
    }).render(true);
  });
}

/**
 * Dialog: defender chooses reaction.
 * To avoid nested dialogs (which can silently fail in Foundry in some cases),
 * we present dodge modes as separate buttons in the same dialog.
 */
function defenseDialog() {
  return new Promise((resolve) => {
    const content = `
      <div class="v-dialog">
        <p style="margin:0 0 8px 0;">Выберите реакцию защиты:</p>
        <p class="hint" style="margin:0 0 10px 0;">Уклонение бросает <b>Движение</b> и сравнивается с атакой. Блок бросает <b>Сопротивление</b>, но попадание всегда.</p>
      </div>
    `;

    new Dialog({
      title: "Защита",
      content,
      buttons: {
        dodgeNormal: {
          label: "Уклонение: обычная",
          callback: () => resolve({ type: "dodge", mode: "normal" }),
        },
        dodgeDis: {
          label: "Уклонение: с помехой",
          callback: () => resolve({ type: "dodge", mode: "dis" }),
        },
        dodgeAdv: {
          label: "Уклонение: с преимуществом",
          callback: () => resolve({ type: "dodge", mode: "adv" }),
        },
        block: {
          label: "Блок (попадание всегда)",
          callback: () => resolve({ type: "block", mode: "normal" }),
        },
      },
      default: "dodgeNormal",
      close: () => resolve(null),
    }).render(true);
  });
}

/** Ask defender reaction; if defender has active owner, ask via socket, else local dialog. */
async function requestDefenseChoice(defenderActor) {
  const owner = findActiveOwner(defenderActor);

  // local (GM/NPC or same user owns)
  if (!owner) return await defenseDialog();

  // socket request to owner
  return await new Promise((resolve) => {
    const reqId = foundry.utils.randomID();

    const handler = (payload) => {
      if (!payload || payload.type !== DEF_RES) return;
      if (payload.reqId !== reqId) return;
      game.socket.off(SOCKET_CHANNEL, handler);
      resolve(payload.choice ?? null);
    };

    game.socket.on(SOCKET_CHANNEL, handler);

    game.socket.emit(SOCKET_CHANNEL, {
      type: DEF_REQ,
      reqId,
      defenderActorId: defenderActor.id,
      toUserId: owner.id,
    });

    // fail-safe: 20s timeout
    setTimeout(() => {
      try {
        game.socket.off(SOCKET_CHANNEL, handler);
      } catch (e) {}
      resolve(null);
    }, 20000);
  });
}

/**
 * Main entry point: attacker uses controlled token, selects target token, clicks "Attack".
 * Requirements:
 * - attacker token: controlled
 * - defender token: targeted (T)
 */
export async function startAttackFlow(attackerActor) {
  try {
    const target = [...(game.user.targets ?? [])][0];
    if (!target) {
      ui.notifications?.warn(
        "Нужно выбрать цель (target) перед атакой (клавиша T)."
      );
      return;
    }
    const defenderActor = target.actor;
    if (!defenderActor) {
      ui.notifications?.warn("Цель без актёра.");
      return;
    }

    // 1) Attacker chooses attack attr + mode
    const atkChoice = await attackDialog();
    if (!atkChoice) return;

    const atkPool = num(attackerActor.system?.attributes?.[atkChoice.attrKey], 1);
    const atkRoll = await rollPool(atkPool, atkChoice.mode);

    // 2) Defender chooses reaction
    const defChoice = await requestDefenseChoice(defenderActor);
    if (!defChoice) return;

    let defRoll = null;
    let hit = false;

    if (defChoice.type === "block") {
      // Always hit; defender rolls resistance (condition) for mitigation
      const resPool = num(defenderActor.system?.attributes?.condition, 1);
      defRoll = await rollPool(resPool, "normal");
      hit = true;
    } else {
      // Dodge: roll movement with mode
      const mvPool = num(defenderActor.system?.attributes?.movement, 1);
      defRoll = await rollPool(mvPool, defChoice.mode);
      hit = atkRoll.successes > defRoll.successes;
    }

    const weaponDamage = getWeaponDamage(attackerActor);
    const armorTotal = getArmorTotal(defenderActor).total;

    let damage = 0;
    if (hit) {
      damage =
        weaponDamage + (atkRoll.successes - (defRoll?.successes ?? 0)) - armorTotal;
      damage = Math.max(0, damage);
    }

    // Apply HP if hit
    if (hit) {
      const hp = defenderActor.system?.attributes?.hp ?? { value: 0, max: 0 };
      const cur = num(hp.value, 0);
      const next = Math.max(0, cur - damage);
      await defenderActor.update({ "system.attributes.hp.value": next });
    }

    await postAttackChat({
      attacker: attackerActor,
      defender: defenderActor,
      atkAttrLabel: atkChoice.attrLabel,
      atkMode: atkChoice.mode,
      defType: defChoice.type,
      defMode: defChoice.mode,
      atkRoll,
      defRoll,
      hit,
      weaponDamage,
      armorTotal,
      damage,
    });
  } catch (err) {
    console.error("Vitruvium | Attack flow error", err);
    ui.notifications?.error(
      `Ошибка атаки: ${err?.message ?? err}`
    );
  }
}
