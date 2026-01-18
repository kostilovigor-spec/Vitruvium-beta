import { VitruviumCharacterSheet } from "./character-sheet.js";
import { VitruviumAbilitySheet } from "./ability-sheet.js";
import { VitruviumItemSheet } from "./item-sheet.js";
import { VitruviumSkillSheet } from "./skill-sheet.js";
import { VitruviumNPCSheet } from "./npc-sheet.js";
import { patchVitruviumInitiative } from "./initiative.js";
import { VitruviumDie } from "./dv-die.js";
import "./dice-so-nice.js";
import { startWeaponAttackFlow } from "./combat.js";

Hooks.once("init", () => {
  console.log("Vitruvium | Initializing system");
  patchVitruviumInitiative();

  const NS = game.system.id; // у тебя это "Vitruvium"

  CONFIG.Dice.terms["V"] = VitruviumDie;
  CONFIG.Dice.terms["v"] = VitruviumDie;

  // Actor sheet
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet(NS, VitruviumCharacterSheet, {
    types: ["character"],
    makeDefault: true,
  });

  Actors.registerSheet("Vitruvium", VitruviumNPCSheet, {
    label: "Vitruvium (NPC)",
    types: ["npc"],
    makeDefault: true,
  });

  // Item sheets
  Items.unregisterSheet("core", ItemSheet);

  Items.registerSheet(NS, VitruviumAbilitySheet, {
    types: ["ability"],
    makeDefault: true,
  });

  Items.registerSheet(NS, VitruviumItemSheet, {
    types: ["item"],
    makeDefault: true,
  });

  Items.registerSheet(NS, VitruviumSkillSheet, {
    types: ["skill"],
    makeDefault: true,
  });

  Items.registerSheet(NS, VitruviumSkillSheet, {
    types: ["state"],
    makeDefault: true,
  });
});

Hooks.once("init", () => {
  game.vitruvium = game.vitruvium ?? {};
  game.vitruvium.startWeaponAttackFlow = startWeaponAttackFlow;
});

Hooks.once("ready", () => {
  game.socket.on("system.Vitruvium", async (payload) => {
    if (!payload) return;

    // Defender prompt
    if (payload.type === "vitruvium-defense-request") {
      if (payload.toUserId !== game.user.id) return;

      const actor = game.actors.get(payload.defenderActorId);
      if (!actor) return;

      // Показываем диалог защиты локально
      const choice = await (async () => {
        // reuse same dialog logic (inline minimal)
        return await new Promise((resolve) => {
          new Dialog({
            title: "Защита",
            content: `<p>Выберите реакцию защиты:</p>`,
            buttons: {
              dodge: {
                label: "Уклониться (движение)",
                callback: async () => {
                  const roll = await new Promise((r) => {
                    new Dialog({
                      title: "Уклонение",
                      content: `<div style="display:grid; gap:8px;">
                        <div>Укажи количество удачливых/неудачливых перебросов.</div>
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
                            r({
                              luck: Math.max(
                                0,
                                Math.min(
                                  20,
                                  Number(html.find("input[name='luck']").val()) || 0
                                )
                              ),
                              unluck: Math.max(
                                0,
                                Math.min(
                                  20,
                                  Number(html.find("input[name='unluck']").val()) || 0
                                )
                              ),
                              fullMode: html.find("select[name='fullMode']").val(),
                            }),
                        },
                        cancel: { label: "Отмена", callback: () => r(null) },
                      },
                      default: "roll",
                      close: () => r(null),
                    }).render(true);
                  });
                  if (!roll) return resolve(null);
                  resolve({ type: "dodge", ...roll });
                },
              },
              block: {
                label: "Блок (сопротивление, но попадание всегда)",
                callback: () => resolve({ type: "block", luck: 0, unluck: 0 }),
              },
            },
            default: "dodge",
            close: () => resolve(null),
          }).render(true);
        });
      })();

      game.socket.emit("system.Vitruvium", {
        type: "vitruvium-defense-response",
        reqId: payload.reqId,
        choice,
      });
    }
  });

  // (опционально) expose API for macros
  game.vitruvium = game.vitruvium || {};
  game.vitruvium.startWeaponAttackFlow = startWeaponAttackFlow;
});
