// Vitruvium combat flow (Dice So Nice compatible)
// - Rolls are attached to ChatMessage via { rolls: [...] } so DSN can render 3D dice.
// - Damage is computed even on miss (shown as potential), but HP is only reduced on hit.
// - Defender dodge supports normal/adv/dis; block always hits (defender rolls condition).
// - New: On FAILED dodge, apply only BODY armor (no shield) at half value (floor). Shield is flagged via item.system.isShield.

function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }
function num(v, d) { const x = Number(v); return Number.isNaN(x) ? d : x; }
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ================= ROLLING ================= */

async function rollPool(pool, mode = "normal") {
  pool = clamp(num(pool, 1), 1, 20);

  const rollOnce = async () => {
    const roll = await new Roll(`${pool}d6`).evaluate({ async: true });
    const results = roll.dice[0].results.map(r => r.result);

    let successes = 0;
    for (const r of results) {
      if (r <= 3) continue;
      if (r <= 5) successes += 1;
      else successes += 2; // 6 = два успеха
    }
    return { roll, results, successes };
  };

  if (mode === "normal") {
    const a = await rollOnce();
    return { mode, pool, chosen: a, successes: a.successes, rolls: [a.roll] };
  }

  const a = await rollOnce();
  const b = await rollOnce();

  const chosen =
    mode === "adv"
      ? (a.successes >= b.successes ? a : b)
      : (a.successes <= b.successes ? a : b);

  return {
    mode,
    pool,
    chosen,
    successes: chosen.successes,
    rolls: [a.roll, b.roll],
  };
}

/* ================= STATS ================= */

// Armor is base system.attributes.armor + sum of equipped item.system.armorBonus (0..6)
// New: item.system.isShield flag lets us exclude shields when needed (e.g., dodge failed).
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

  return { total: base + bonus };
}

function getWeaponDamage(actor) {
  let best = 0;
  for (const it of actor.items ?? []) {
    if (it.type !== "item") continue;
    if (!it.system?.equipped) continue;
    best = Math.max(best, num(it.system.damage, 0));
  }
  return best > 0 ? best : num(actor.system?.attributes?.attack, 0);
}

/* ================= CHAT ================= */

async function postAttackChat({
  attacker,
  defender,
  atkLabel,
  atkMode,
  defLabel,
  atkS,
  defS,
  hit,
  weaponDamage,
  armor,
  damage,
  rolls = [],
}) {
  const content = `
  <div class="vitruvium-chatcard">
    <h3>${esc(attacker.name)} атакует ${esc(defender.name)}</h3>
    <p class="hint">
      Атака: ${esc(atkLabel)} (${esc(atkMode)}) · Защита: ${esc(defLabel)}
    </p>

    <p><b>Успехи атаки:</b> ${atkS}</p>
    <p><b>Успехи защиты:</b> ${defS}</p>
    <hr>

    ${
      hit
        ? `<p><b>ПОПАДАНИЕ.</b> Урон оружия ${weaponDamage}
           + (${atkS} − ${defS}) − броня ${armor}
           = <b>${damage}</b></p>`
        : `<p><b>ПРОМАХ.</b></p>
           <p class="hint"><b>Потенциальный урон при попадании:</b>
           ${weaponDamage} + (${atkS} − ${defS}) − ${armor}
           = <b>${damage}</b></p>`
    }
  </div>`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    content,
    rolls, // IMPORTANT: Dice So Nice hooks into ChatMessage.rolls
  });
}

/* ================= DIALOGS ================= */

function attackDialog() {
  return new Promise(resolve => {
    new Dialog({
      title: "Атака",
      content: `
      <label>Атрибут атаки
        <select name="attr" style="width:100%">
          <option value="combat">Сражение</option>
          <option value="thinking">Мышление</option>
        </select>
      </label>`,
      buttons: {
        normal: {
          label: "Обычная",
          callback: html => resolve({ attrKey: html.find("select").val(), mode: "normal" }),
        },
        adv: {
          label: "С преимуществом",
          callback: html => resolve({ attrKey: html.find("select").val(), mode: "adv" }),
        },
        dis: {
          label: "С помехой",
          callback: html => resolve({ attrKey: html.find("select").val(), mode: "dis" }),
        },
      },
      close: () => resolve(null),
    }).render(true);
  });
}

function defenseDialog() {
  return new Promise(resolve => {
    new Dialog({
      title: "Защита",
      content: `<p>Выберите реакцию защиты</p>`,
      buttons: {
        dodgeNormal: {
          label: "Уклонение (обычное)",
          callback: () => resolve({ type: "dodge", mode: "normal" }),
        },
        dodgeAdv: {
          label: "Уклонение (с преимуществом)",
          callback: () => resolve({ type: "dodge", mode: "adv" }),
        },
        dodgeDis: {
          label: "Уклонение (с помехой)",
          callback: () => resolve({ type: "dodge", mode: "dis" }),
        },
        block: {
          label: "Блок",
          callback: () => resolve({ type: "block" }),
        },
      },
      close: () => resolve(null),
    }).render(true);
  });
}

/* ================= MAIN ================= */

export async function startAttackFlow(attackerActor) {
  try {
    const target = [...game.user.targets][0];
    if (!target) {
      ui.notifications?.warn("Нет цели (target).");
      return;
    }

    const defenderActor = target.actor;
    if (!defenderActor) {
      ui.notifications?.warn("Цель без актёра.");
      return;
    }

    const atkChoice = await attackDialog();
    if (!atkChoice) return;

    const atkPool = num(attackerActor.system?.attributes?.[atkChoice.attrKey], 1);
    const atkRoll = await rollPool(atkPool, atkChoice.mode);

    const defChoice = await defenseDialog();
    if (!defChoice) return;

    let defRoll;
    let hit = false;

    if (defChoice.type === "block") {
      defRoll = await rollPool(num(defenderActor.system?.attributes?.condition, 1), "normal");
      hit = true; // block always gets hit, but reduces damage via condition successes
    } else {
      defRoll = await rollPool(
        num(defenderActor.system?.attributes?.movement, 1),
        defChoice.mode ?? "normal"
      );
      hit = atkRoll.successes > defRoll.successes;
    }

    const weaponDamage = getWeaponDamage(attackerActor);

    // Full armor (body + shield) baseline
    const armorFull = getArmorTotal(defenderActor, { includeShield: true }).total;

    // If dodge fails (hit), apply only BODY armor (exclude shield) at half value (floor)
    const armorBodyOnly = getArmorTotal(defenderActor, { includeShield: false }).total;
    const armorDodgeFailed = Math.floor(armorBodyOnly / 2);

    // Armor used depends on defense type and outcome
    let armorUsed = armorFull;
    if (defChoice.type === "dodge" && hit) armorUsed = armorDodgeFailed;

    // Damage is computed ALWAYS (shown even on miss)
    let damage = weaponDamage + (atkRoll.successes - defRoll.successes) - armorUsed;
    damage = Math.max(0, damage);

    // HP is reduced ONLY on hit
    if (hit) {
      const hp = defenderActor.system?.attributes?.hp ?? { value: 0, max: 0 };
      const cur = num(hp.value, 0);
      await defenderActor.update({ "system.attributes.hp.value": Math.max(0, cur - damage) });
    }

    const chatRolls = [
      ...(atkRoll.rolls ?? []),
      ...(defRoll.rolls ?? []),
    ];

    const defLabel =
      defChoice.type === "block"
        ? "Блок"
        : `Уклонение (${defChoice.mode ?? "normal"})`;

    await postAttackChat({
      attacker: attackerActor,
      defender: defenderActor,
      atkLabel: atkChoice.attrKey === "thinking" ? "Мышление" : "Сражение",
      atkMode: atkChoice.mode,
      defLabel,
      atkS: atkRoll.successes,
      defS: defRoll.successes,
      hit,
      weaponDamage,
      armor: armorUsed,
      damage,
      rolls: chatRolls,
    });
  } catch (e) {
    console.error("Vitruvium | startAttackFlow error", e);
    ui.notifications?.error(`Ошибка атаки: ${e?.message ?? e}`);
  }
}

/* ================= AIR ATTACK ================= */

export async function startAirAttackFlow(attackerActor) {
  try {
    const atkChoice = await attackDialog();
    if (!atkChoice) return;

    const atkPool = num(attackerActor.system?.attributes?.[atkChoice.attrKey], 1);
    const atkRoll = await rollPool(atkPool, atkChoice.mode);
    const weaponDamage = getWeaponDamage(attackerActor);

    // Air attack damage: weaponDamage + attack successes (no defender, no armor)
    const totalDamage = Math.max(0, weaponDamage + atkRoll.successes);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
      content: `
      <div class="vitruvium-chatcard">
        <h3>${esc(attackerActor.name)} — атака в воздух</h3>
        <p class="hint">Атака: ${esc(atkChoice.attrKey === "thinking" ? "Мышление" : "Сражение")} (${esc(atkChoice.mode)})</p>
        <p><b>Успехи атаки:</b> ${atkRoll.successes}</p>
        <hr>
        <p><b>Урон:</b> ${weaponDamage} + ${atkRoll.successes} = <b>${totalDamage}</b></p>
      </div>
      `,
      rolls: atkRoll.rolls ?? [], // IMPORTANT for Dice So Nice
    });
  } catch (e) {
    console.error("Vitruvium | startAirAttackFlow error", e);
    ui.notifications?.error(`Ошибка атаки: ${e?.message ?? e}`);
  }
}
