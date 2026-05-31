import sharedRestaurants from "../../../shared/restaurants.json";

const allRestaurants = sharedRestaurants.restaurants;

export const RESTAURANT_GROUPS = allRestaurants.map((g) => ({
  label: g.label,
  companyId: g.companyId,
  items: g.branches.map((b) => ({ value: b.id, label: b.name })),
}));

export const findRestaurantLabel = (value) => {
  for (const group of RESTAURANT_GROUPS) {
    const m = group.items.find((i) => i.value === value);
    if (m) return `${group.label} — ${m.label}`;
  }
  return "";
};

export const filterRestaurantGroups = (allowed) => {
  if (!Array.isArray(allowed) || allowed.length === 0) return RESTAURANT_GROUPS;
  if (allowed.includes("*")) return RESTAURANT_GROUPS;
  const set = new Set(allowed);
  return RESTAURANT_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((i) => set.has(i.value)),
  })).filter((group) => group.items.length > 0);
};
