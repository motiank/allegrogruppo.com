export const RESTAURANT_GROUPS = [
  {
    label: "פרימיום איטליה",
    items: [
      { value: "64be1926335ee46a739a1ba2", label: "ג'ויה" },
      { value: "65cda80518611cc1cab248ca", label: "לה בראצ׳ה" },
      { value: "64251a9f37dc3d5093d7ab53", label: "פיאמונטה" },
      { value: "64ddcfdc674a1d497fe49bf8", label: "פסקרה" },
    ],
  },
  {
    label: "פסטה לינה",
    items: [
      { value: "5fd7030f4f421bfe0e2e13bd", label: "הרצליה" },
      { value: "5ff419934676f0fddabaef3a", label: "רעננה" },
      { value: "6012624f0d491ef6429e127c", label: "רמת החיל" },
      { value: "655ef6eb9df0c279bbfb7482", label: "ראש פינה" },
    ],
  },
  {
    label: "ורדה אונו",
    items: [
      { value: "60335d23cac0e25c17fe0544", label: "תל אביב" },
      { value: "6322b93aaf5f6e3b92830433", label: "פתח תקווה" },
    ],
  },
  {
    label: "שי",
    items: [
      { value: "60b46ca4e8418d9c860b2b2f", label: "נתניה" },
      { value: "62f48ec8ab47895a757e1c76", label: "מודיעין" },
    ],
  },
  {
    label: "אור ים",
    items: [{ value: "65bb40ae6729db482e2ed6f2", label: "אור ים" }],
  },
];

export const findRestaurantLabel = (value) => {
  for (const group of RESTAURANT_GROUPS) {
    const m = group.items.find((i) => i.value === value);
    if (m) return `${group.label} — ${m.label}`;
  }
  return "";
};

export const filterRestaurantGroups = (allowed) => {
  if (!Array.isArray(allowed) || allowed.length === 0) return RESTAURANT_GROUPS;
  const set = new Set(allowed);
  return RESTAURANT_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((i) => set.has(i.value)),
  })).filter((group) => group.items.length > 0);
};
