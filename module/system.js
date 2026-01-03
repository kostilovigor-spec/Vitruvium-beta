import { VitruviumCharacterSheet } from "./character-sheet.js";
import { VitruviumAbilitySheet } from "./ability-sheet.js";
import { VitruviumItemSheet } from "./item-sheet.js";
import { VitruviumNPCSheet } from "./npc-sheet.js";
import { patchVitruviumInitiative } from "./initiative.js";
import "./dice-so-nice.js";
import { startAttackFlow } from "./combat.js";

Hooks.once("init", () => {
  console.log("Vitruvium | Initializing system");
  patchVitruviumInitiative();

  const NS = game.system.id; // у тебя это "Vitruvium"

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
                  // режим
                  const mode = await new Promise((r) => {
                    new Dialog({
                      title: "Уклонение",
                      content: `<p>Режим броска:</p>`,
                      buttons: {
                        normal: {
                          label: "Обычная",
                          callback: () => r("normal"),
                        },
                        dis: { label: "С помехой", callback: () => r("dis") },
                        adv: {
                          label: "С преимуществом",
                          callback: () => r("adv"),
                        },
                      },
                      default: "normal",
                      close: () => r(null),
                    }).render(true);
                  });
                  if (!mode) return resolve(null);
                  resolve({ type: "dodge", mode });
                },
              },
              block: {
                label: "Блок (сопротивление, но попадание всегда)",
                callback: () => resolve({ type: "block", mode: "normal" }),
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
  game.vitruvium = game.vitruvium ?? {};
  game.vitruvium.startAttackFlow = startAttackFlow;
});
