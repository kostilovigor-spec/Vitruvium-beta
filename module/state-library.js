const norm = (v) => String(v ?? "").trim().toLowerCase();

const isSystemPack = (pack) => {
  const md = pack?.metadata ?? {};
  const packageType = norm(md.packageType);
  const packageName = norm(md.packageName ?? md.package);
  const systemId = norm(game.system?.id);

  if (packageType && packageType !== "system") return false;
  if (packageName && systemId && packageName !== systemId) return false;
  return true;
};

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  if (typeof v.values === "function") return [...v.values()];
  return [];
};

export const getSystemStatesPack = () => {
  const packs = asArray(game.packs);
  const statePacks = packs.filter(
    (pack) =>
      pack?.documentName === "Item" &&
      String(pack?.metadata?.label ?? "").trim() === "Состояния"
  );
  if (!statePacks.length) return null;
  const exactSystem = statePacks.find(isSystemPack);
  return exactSystem ?? statePacks[0];
};

export const listSystemStateTemplates = async () => {
  const pack = getSystemStatesPack();
  if (!pack) return [];

  const index = await pack.getIndex({ fields: ["type", "name", "img"] });
  const entries = asArray(index);
  const out = [];

  for (const entry of entries) {
    if (String(entry?.type ?? "") !== "state") continue;
    const id = String(entry?._id ?? "").trim();
    if (!id) continue;
    out.push({
      id,
      uuid: `Compendium.${pack.collection}.${id}`,
      name: String(entry?.name ?? "Состояние"),
      img: String(entry?.img ?? "icons/svg/aura.svg"),
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return out;
};

export const getStateTemplateByUuid = async (uuid) => {
  const ref = String(uuid ?? "").trim();
  if (!ref) return null;
  const doc = await fromUuid(ref);
  if (!doc || doc.documentName !== "Item") return null;
  if (String(doc.type ?? "") !== "state") return null;
  return doc;
};
