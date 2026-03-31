/**
 * Handles the drop event on the Foundry VTT Chat Log.
 * When an item, ability, skill, or state is dropped onto the chat,
 * it creates a chat message with a draggable link.
 */
export function registerChatDropHook() {
  Hooks.on("renderChatLog", (app, html, data) => {
    const chatLog = html[0].querySelector("#chat-log") || html[0];

    chatLog.addEventListener("drop", async (event) => {
      event.preventDefault();

      let data;
      try {
        data = JSON.parse(event.dataTransfer.getData("text/plain"));
      } catch (err) {
        return;
      }

      // We only care about Items (which include abilities, skills, and states in this system)
      if (data.type !== "Item") return;

      const item = await Item.fromDropData(data);
      if (!item) return;

      // Extract the original actor if available
      const actor = item.actor;
      const speaker = ChatMessage.getSpeaker({ actor });

      // Create a chat card similar to the post-to-chat action
      // but ensure it has a draggable @UUID link.
      // Escape helper for safe HTML in chat content.
      const esc = (s) =>
        String(s ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#039;");

      const desc = String(item.system?.description ?? "");
      const descHtml = desc
        ? esc(desc).replace(/\n/g, "<br>")
        : `<span class="hint">Описание не задано.</span>`;

      const isItem = item.type === "item";
      const qty = isItem ? Number(item.system?.quantity ?? 1) : null;
      const qtyText = isItem && Number.isFinite(qty) ? ` ×${qty}` : "";
      const typeLabel =
        {
          ability: "Способность",
          skill: "Навык",
          state: "Состояние",
          item: "Предмет",
        }[item.type] || "Предмет";

      const content = `
        <div class="vitruvium-chatcard v-itemcard">
          <div class="v-itemcard__top">
            <img class="v-itemcard__img" src="${esc(item.img)}" alt="${esc(item.name)}"/>
            <div class="v-itemcard__head">
              <div class="v-itemcard__title">@UUID[${item.uuid}]{${esc(item.name)}}${qtyText}</div>
              <div class="v-itemcard__sub">${esc(actor ? actor.name : "Мировое")} · ${typeLabel}</div>
            </div>
          </div>
          <div class="v-itemcard__desc">${descHtml}</div>
        </div>
      `;

      await ChatMessage.create({
        content,
        speaker: speaker,
      });
    });
  });
}
