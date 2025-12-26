// systems/vitruvium/module/dice-so-nice.js
Hooks.once("diceSoNiceReady", (dice3d) => {
  const systemId = game.system.id;

  dice3d.addSystem({ id: systemId, name: "Vitruvium" }, true);

  const blank = `systems/${systemId}/assets/dice/blank.png`;
  const single = `systems/${systemId}/assets/dice/success.png`;
  const double = `systems/${systemId}/assets/dice/double.png`;

  // d6: 1-3 пусто, 4-5 успех, 6 двойной успех
  dice3d.addDicePreset({
    type: "d6",
    labels: [blank, blank, blank, single, single, double],
    system: systemId,
  });
});
