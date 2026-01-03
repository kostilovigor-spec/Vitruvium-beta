// Vitruvium combat flow
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

/* ================= ROLLING ================= */

async function rollPool(pool, mode = "normal") {
  pool = clamp(num(pool, 1), 1, 20);

  const rollOnce = async () => {
    const roll = await new Roll(`${pool}d6`).evaluate({ async: true });
    const results = roll.dice[0].results.map((r) => r.result);
    let successes = 0;
    for (const r of results) {
      if (r <= 3) continue;
      if (r <= 5) successes += 1;
      else successes += 2;
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
      ? a.successes >= b.successes
        ? a
        : b
      : a.successes <= b.successes
      ? a
      : b;

  return {
    mode,
    pool,
    chosen,
    successes: chosen.successes,
    rolls: [a.roll, b.roll],
  };
}

/* ================= STATS ================= */

function getArmorTotal(actor) {
  const base = num(actor.system?.attributes?.armor, 0);
  let bonus = 0;
  for (const it of actor.items ?? []) {
    if (it.type !== "item") continue;
    if (!it.system?.equipped) continue;
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
}) {
  const content = `
  <div class="vitruvium-chatcard">
    <h3>${esc(attacker.name)} атакует ${esc(defender.name)}</h3>
    <p class="hint">
      Атака: ${esc(atkLabel)} (${atkMode}) · Защита: ${esc(defLabel)}
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
  });
}

/* ================= DIALOGS ================= */

function attackDialog() {
  return new Promise((resolve) => {
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
          callback: (html) =>
            resolve({
              attrKey: html.find("select").val(),
              mode: "normal",
            }),
        },
        adv: {
          label: "С преимуществом",
          callback: (html) =>
            resolve({
              attrKey: html.find("select").val(),
              mode: "adv",
            }),
        },
        dis: {
          label: "С помехой",
          callback: (html) =>
            resolve({
              attrKey: html.find("select").val(),
              mode: "dis",
            }),
        },
      },
      close: () => resolve(null),
    }).render(true);
  });
}

function defenseDialog() {
  return new Promise((resolve) => {
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
  const target = [...game.user.targets][0];
  if (!target) {
    ui.notifications.warn("Нет цели");
    return;
  }

  const defenderActor = target.actor;
  const atkChoice = await attackDialog();
  if (!atkChoice) return;

  const atkPool = num(attackerActor.system.attributes[atkChoice.attrKey], 1);
  const atkRoll = await rollPool(atkPool, atkChoice.mode);

  const defChoice = await defenseDialog();
  if (!defChoice) return;

  let defRoll;
  let hit = false;

  if (defChoice.type === "block") {
    defRoll = await rollPool(
      num(defenderActor.system.attributes.condition, 1),
      "normal"
    );
    hit = true;
  } else {
    defRoll = await rollPool(
      num(defenderActor.system.attributes.movement, 1),
      defChoice.mode ?? "normal"
    );
    hit = atkRoll.successes > defRoll.successes;
  }

  const weaponDamage = getWeaponDamage(attackerActor);
  const armor = getArmorTotal(defenderActor).total;

  // УРОН СЧИТАЕТСЯ ВСЕГДА
  let damage = weaponDamage + (atkRoll.successes - defRoll.successes) - armor;
  damage = Math.max(0, damage);

  // HP списывается ТОЛЬКО при попадании
  if (hit) {
    const hp = defenderActor.system.attributes.hp;
    await defenderActor.update({
      "system.attributes.hp.value": Math.max(0, hp.value - damage),
    });
  }

  await postAttackChat({
    attacker: attackerActor,
    defender: defenderActor,
    atkLabel: atkChoice.attrKey === "thinking" ? "Мышление" : "Сражение",
    atkMode: atkChoice.mode,
    defLabel:
      defChoice.type === "block" ? "Блок" : `Уклонение (${defChoice.mode})`,
    atkS: atkRoll.successes,
    defS: defRoll.successes,
    hit,
    weaponDamage,
    armor,
    damage,
  });
}

/* ================= AIR ATTACK ================= */

export async function startAirAttackFlow(attackerActor) {
  const atkChoice = await attackDialog();
  if (!atkChoice) return;

  const atkPool = num(attackerActor.system.attributes[atkChoice.attrKey], 1);
  const atkRoll = await rollPool(atkPool, atkChoice.mode);
  const weaponDamage = getWeaponDamage(attackerActor);

  const totalDamage = Math.max(0, weaponDamage + atkRoll.successes);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attackerActor }),
    content: `
    <div class="vitruvium-chatcard">
      <h3>${esc(attackerActor.name)} — атака в воздух</h3>
      <p><b>Успехи атаки:</b> ${atkRoll.successes}</p>
      <p><b>Урон:</b> ${weaponDamage} + ${
      atkRoll.successes
    } = <b>${totalDamage}</b></p>
    </div>
    `,
    rolls: rolls ?? [],
  });
}
