// systems/Vitruvium/module/dice-so-nice.js
// Dice So Nice integration for Vitruvium "dV" dice.
//
// Put your textures here (recommended):
// systems/Vitruvium/assets/dice/BLANK.webp
// systems/Vitruvium/assets/dice/SINGLE.webp
// systems/Vitruvium/assets/dice/DOUBLE.webp
//
// If you use .png, just change extensions below.

Hooks.once("diceSoNiceReady", (dice3d) => {
  const systemId = (game.system?.id ?? "vitruvium").toLowerCase();

  // Register system (so presets are grouped under your system)
  dice3d.addSystem(
    { id: systemId, name: game.system?.title ?? "Vitruvium" },
    true
  );

  const base = `systems/${game.system.id}/assets/dice`;
  const blank = `${base}/blank.png`;
  const single = `${base}/success.png`;
  const double = `${base}/double.png`;

  // Faces: 1-3 blank, 4-5 single, 6 double
  const labels = [blank, blank, blank, single, single, double];

  // Dice preset for dV (uses d6 model under the hood)
  dice3d.addDicePreset({
    type: "dV",
    labels,
    system: systemId,
  });
});
