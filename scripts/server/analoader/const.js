import { createRequire } from "module";
const require = createRequire(import.meta.url);
const sharedRestaurants = require("../../../shared/restaurants.json");
const allRestaurants = sharedRestaurants.restaurants;

const rest_map = {};
for (const g of allRestaurants) {
  rest_map[g.key] = {
    id: g.companyId,
    map: g.branches.map((b) => ({
      id: b.id,
      branchName: b.name,
      ontopo: b.ontopo,
      astrateg: b.astrateg,
    })),
  };
}

export { rest_map };
