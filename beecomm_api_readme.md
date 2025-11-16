# Beecomm Order Center Integration (Node.js)

This project-level `README.md` explains how to use the **Beecomm Order Center API** from a **plain Node.js project** (no framework required) to:

1. Authenticate and obtain an access token  
2. Fetch the **access list** (restaurants and branches)  
3. Fetch and keep the **full menu** in sync  
4. **Push an order** to Beecomm once the user confirms it  

Code examples are in **JavaScript** (Node.js) with **JSDoc/TypeScript-style types** so tools like **Cursor** can infer types and help you implement the full integration.

> ⚠️ You must have valid Beecomm credentials (`client_id`, `client_secret`) and access to their production/test environment. Replace all placeholder values in the examples with real ones from your Beecomm account.

---

## 1. Project Setup

### 1.1. Requirements

- Node.js **18+**
- `npm` or `yarn`
- Beecomm API credentials:
  - `client_id`
  - `client_secret`
- Base URL (example, verify with your spec):
  - `https://api.beecommcloud.com/v1/`

### 1.2. Initialize a Node.js project

```bash
mkdir beecomm-integration
cd beecomm-integration
npm init -y
```

### 1.3. Install dependencies

We will use:

- `axios` – HTTP client
- `dotenv` – load environment variables from `.env`

```bash
npm install axios dotenv
```

### 1.4. Create `.env` file

At the root of the project, create `.env`:

```env
BEECOMM_CLIENT_ID=your-client-id-here
BEECOMM_CLIENT_SECRET=your-client-secret-here
BEECOMM_API_BASE_URL=https://api.beecommcloud.com/v1
```

> Do **not** commit `.env` into version control. Add it to `.gitignore`.

Create `.gitignore`:

```gitignore
node_modules
.env
```

---

## 2. Simple project structure

Suggested file layout:

```text
beecomm-integration/
  .env
  package.json
  README.md
  src/
    config.js
    beecommClient.js
    menuExample.js
    pushOrderExample.js
```

- `config.js` – loads environment variables and exposes config
- `beecommClient.js` – core Beecomm API client (auth, menu, orders)
- `menuExample.js` – example: fetch and print the full menu
- `pushOrderExample.js` – example: build and push a sample order

Create the `src` directory:

```bash
mkdir src
```

---

## 3. Configuration Loader (`src/config.js`)

```js
// src/config.js
import dotenv from "dotenv";
dotenv.config();

/**
 * Basic configuration for Beecomm API
 */
export const config = {
  apiBaseUrl: process.env.BEECOMM_API_BASE_URL ?? "https://api.beecommcloud.com/v1",
  clientId: process.env.BEECOMM_CLIENT_ID,
  clientSecret: process.env.BEECOMM_CLIENT_SECRET,
};

if (!config.clientId || !config.clientSecret) {
  console.warn(
    "[Beecomm Config] Missing BEECOMM_CLIENT_ID or BEECOMM_CLIENT_SECRET in .env"
  );
}
```

> If you prefer CommonJS (`require`) instead of ESM (`import`), you can rename files to `.cjs` and adjust `package.json` accordingly. The logic stays the same.

---

## 4. Beecomm API Client (`src/beecommClient.js`)

This module wraps the key API operations:

- `getAccessToken()` – authenticate and get `access_token`
- `getAccessList(accessToken)` – get available restaurants and branches
- `getMenuRevision(accessToken, restaurantId, branchId)` – check menu revision
- `getMenu(accessToken, restaurantId, branchId)` – get full menu
- `pushOrder(accessToken, payload)` – push an order

```js
// src/beecommClient.js
import axios from "axios";
import { config } from "./config.js";

/**
 * @typedef {Object} BeecommAccessTokenResponse
 * @property {boolean} result
 * @property {string} requestId
 * @property {string} message
 * @property {string} access_token
 */

/**
 * @typedef {Object} BeecommAccessListBranch
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {Object} BeecommAccessListRestaurant
 * @property {string} restaurantId
 * @property {string} restaurantName
 * @property {BeecommAccessListBranch[]} branches
 */

/**
 * @typedef {Object} BeecommAccessListResponse
 * @property {boolean} result
 * @property {string} request_id
 * @property {BeecommAccessListRestaurant[]} access_list
 */

/**
 * @typedef {Object} BeecommMenuRevisionResponse
 * @property {boolean} result
 * @property {string} request_id
 * @property {number} status
 * @property {string} menuRevision
 * @property {string} lastUpdate
 * @property {string} message
 */

/**
 * @typedef {Object} BeecommDeliveryMenuResponse
 * @property {boolean} result
 * @property {string} requestId
 * @property {number} status
 * @property {string} message
 * @property {string} lastUpdate
 * @property {string} menuRevision
 * @property {Object} deliveryMenu
 */

/**
 * @typedef {Object} BeecommPushOrderResponse
 * @property {boolean} result
 * @property {string} request_id
 * @property {number} status
 * @property {string} message
 * @property {number} [orderNumber]
 */

const api = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 10000,
});

/**
 * Get access token from Beecomm API using client_id and client_secret.
 *
 * @returns {Promise<string>} access_token
 */
export async function getAccessToken() {
  try {
    const params = new URLSearchParams();
    params.append("client_id", config.clientId);
    params.append("client_secret", config.clientSecret);

    const { data } = await api.post("/auth/token", params);
    /** @type {BeecommAccessTokenResponse} */
    const resp = data;

    if (!resp.result) {
      throw new Error(
        `Beecomm auth failed: ${resp.message || "Unknown error"} (requestId=${resp.requestId})`
      );
    }

    if (!resp.access_token) {
      throw new Error("Beecomm auth: missing access_token in response");
    }

    return resp.access_token;
  } catch (err) {
    console.error("[Beecomm] getAccessToken error:", err.message);
    throw err;
  }
}

/**
 * Get access list (restaurants & branches) for the current account.
 *
 * @param {string} accessToken
 * @returns {Promise<BeecommAccessListResponse>}
 */
export async function getAccessList(accessToken) {
  const { data } = await api.get("/ext/getAccessList", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return data;
}

/**
 * Get menu revision for a specific restaurant & branch.
 *
 * @param {string} accessToken
 * @param {string} restaurantId
 * @param {string} branchId
 * @returns {Promise<BeecommMenuRevisionResponse>}
 */
export async function getMenuRevision(accessToken, restaurantId, branchId) {
  const { data } = await api.post(
    "/order-center/getMenuRevision",
    {
      restaurantId,
      branchId,
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  return /** @type {BeecommMenuRevisionResponse} */ (data);
}

/**
 * Get full delivery menu for a specific restaurant & branch.
 *
 * @param {string} accessToken
 * @param {string} restaurantId
 * @param {string} branchId
 * @returns {Promise<BeecommDeliveryMenuResponse>}
 */
export async function getMenu(accessToken, restaurantId, branchId) {
  const { data } = await api.post(
    "/order-center/getMenu",
    {
      restaurantId,
      branchId,
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  return /** @type {BeecommDeliveryMenuResponse} */ (data);
}

/**
 * Push an order to Beecomm.
 *
 * @param {string} accessToken
 * @param {Object} orderPayload - Delivery Order Model payload
 * @returns {Promise<BeecommPushOrderResponse>}
 */
export async function pushOrder(accessToken, orderPayload) {
  const { data } = await api.post("/order-center/pushOrder", orderPayload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return /** @type {BeecommPushOrderResponse} */ (data);
}
```

> You can extend this client with logging, retries, rate limiting, etc. The types are defined with JSDoc to be TypeScript-friendly.

---

## 5. Fetch and Print the Menu (`src/menuExample.js`)

This script shows how to:

1. Authenticate
2. Get access list
3. Choose a restaurant & branch
4. Get the menu revision and the full menu

```js
// src/menuExample.js
import {
  getAccessToken,
  getAccessList,
  getMenuRevision,
  getMenu,
} from "./beecommClient.js";

/**
 * Simple example: fetch and print the menu structure
 */
async function main() {
  try {
    const accessToken = await getAccessToken();
    console.log("[Beecomm] Access token received");

    const accessListResp = await getAccessList(accessToken);
    if (!accessListResp.result || !accessListResp.access_list?.length) {
      throw new Error("No access_list returned from Beecomm");
    }

    const restaurant = accessListResp.access_list[0];
    const branch = restaurant.branches[0];

    console.log(`[Beecomm] Using restaurantId=${restaurant.restaurantId}, branchId=${branch.id}`);

    const menuRevResp = await getMenuRevision(
      accessToken,
      restaurant.restaurantId,
      branch.id
    );

    if (!menuRevResp.result) {
      throw new Error(
        `getMenuRevision failed: ${menuRevResp.message} (status=${menuRevResp.status})`
      );
    }

    console.log(
      `[Beecomm] Current menuRevision=${menuRevResp.menuRevision} (lastUpdate=${menuRevResp.lastUpdate})`
    );

    const menuResp = await getMenu(accessToken, restaurant.restaurantId, branch.id);
    if (!menuResp.result) {
      throw new Error(
        `getMenu failed: ${menuResp.message} (status=${menuResp.status})`
      );
    }

    console.log(
      `[Beecomm] Got menuRevision=${menuResp.menuRevision}, lastUpdate=${menuResp.lastUpdate}`
    );

    const categories = menuResp.deliveryMenu?.categories ?? [];
    console.log(`[Beecomm] Loaded ${categories.length} categories`);

    // Print categories and the number of dishes in each subcategory
    for (const category of categories) {
      console.log(`Category: ${category.name}`);

      for (const sub of category.subCategories ?? []) {
        const dishCount = (sub.dishes ?? []).length;
        console.log(`  SubCategory: ${sub.name} (dishes: ${dishCount})`);
      }
    }
  } catch (err) {
    console.error("[Beecomm] menuExample error:", err);
    process.exit(1);
  }
}

main();
```

Run it with:

```bash
node src/menuExample.js
```

---

## 6. Building and Pushing an Order (`src/pushOrderExample.js`)

This example shows how to:

1. Authenticate
2. Get restaurant/branch
3. Fetch menu
4. Pick a dish
5. Build a minimal delivery order payload
6. Call `pushOrder`

> ⚠️ This is a **simplified example**. In production you must:
> - Respect `toppingGroups` `minQuantity`/`maxQuantity`
> - Validate user selections against the menu
> - Calculate prices exactly according to the menu
> - Handle delivery vs takeaway (`orderType` 3 vs 2)
> - Handle different payment types (credit, cash, etc.)

```js
// src/pushOrderExample.js
import {
  getAccessToken,
  getAccessList,
  getMenu,
  pushOrder,
} from "./beecommClient.js";

/**
 * Helper: build a very simple sample order payload.
 *
 * @param {Object} args
 * @param {string} args.restaurantId
 * @param {string} args.branchId
 * @param {string} args.menuRevision
 * @param {Object} args.sampleDish
 */
function buildSampleOrder({ restaurantId, branchId, menuRevision, sampleDish }) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  const purchaseTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const quantity = 1;
  const dishPrice = sampleDish.price ?? 0;
  const deliveryCost = 10; // example
  const discountAmount = 0;
  const orderTotal = dishPrice * quantity + deliveryCost - discountAmount;

  const internalOrderId = `demo-${now.getTime()}`; // must be unique per day

  const payload = {
    restaurantId,
    branchId,
    menuRevision,
    orderInfo: {
      orderType: 3, // 2 = takeaway, 3 = delivery
      comments: "Demo order from Node.js",
      discountAmount,
      internalOrderId,
      dinnersCount: 1,
      purchaseTime,
      orderTotal,
      dinners: [
        {
          firstName: "John",
          lastName: "Doe",
          phoneNumber: "0500000000",
          emailAddress: "john.doe@example.com",
          items: [
            {
              dishId: sampleDish.dishId,
              itemName: sampleDish.name,
              isCombo: !!sampleDish.isCombo,
              quantity,
              dishPrice,
              totalPrice: dishPrice * quantity,
              preparationComments: "No onions, please",
              remarks: [],
              toppings: [],
              subItems: [],
            },
          ],
        },
      ],
      payments: [
        {
          charged: false, // false = pay at restaurant (e.g., cash)
          paymentType: 2, // 1=Credit, 2=Cash, etc.
          paymentSum: orderTotal,
          tip: 0,
          cardInfo: {
            approvalNumber: "",
            cardNumber: "",
            cardExpirationDate: "",
            cardHolderName: "",
            cvv: 0,
          },
        },
      ],
      deliveryInfo: {
        firstName: "John",
        lastName: "Doe",
        cityName: "Tel Aviv",
        streetName: "Dizengoff",
        homeNumber: "10",
        addressGeoLocation_lat: "32.0853",
        addressGeoLocation_lng: "34.7818",
        formattedAddress: "Dizengoff 10, Tel Aviv",
        eta: 45, // minutes
        disposableCutlery: true,
        entrance: "A",
        entranceCode: "1234",
        doorName: "Doe",
        companyName: "",
        deliveryLocationType: "street",
        leaveOutside: false,
        residenceType: "building",
        apartmentNumber: "2",
        floor: "1",
        deliveryCost,
        phoneNumber: "039999999",
        cellular: "0500000000",
        remarks: "Ring twice",
      },
    },
  };

  return payload;
}

async function main() {
  try {
    const accessToken = await getAccessToken();
    console.log("[Beecomm] Access token received");

    const accessListResp = await getAccessList(accessToken);
    const restaurant = accessListResp.access_list[0];
    const branch = restaurant.branches[0];

    console.log(
      `[Beecomm] Using restaurantId=${restaurant.restaurantId}, branchId=${branch.id}`
    );

    const menuResp = await getMenu(accessToken, restaurant.restaurantId, branch.id);
    if (!menuResp.result) {
      throw new Error(
        `getMenu failed: ${menuResp.message} (status=${menuResp.status})`
      );
    }

    const menuRevision = menuResp.menuRevision;
    const categories = menuResp.deliveryMenu?.categories ?? [];
    if (categories.length === 0) {
      throw new Error("No categories found in deliveryMenu");
    }

    const firstCategory = categories[0];
    const firstSub = firstCategory.subCategories?.[0];
    const firstDish = firstSub?.dishes?.[0];

    if (!firstDish) {
      throw new Error("No dishes found to use as sample");
    }

    console.log(`[Beecomm] Sample dish: ${firstDish.name} (dishId=${firstDish.dishId})`);

    const orderPayload = buildSampleOrder({
      restaurantId: restaurant.restaurantId,
      branchId: branch.id,
      menuRevision,
      sampleDish: firstDish,
    });

    console.log("[Beecomm] Sending pushOrder...");
    const resp = await pushOrder(accessToken, orderPayload);

    console.log("[Beecomm] pushOrder response:", resp);

    if (!resp.result) {
      console.error(
        `[Beecomm] pushOrder FAILED: status=${resp.status}, message=${resp.message}`
      );
      // Handle specific status codes (22 = outdated menu, 30 = total mismatch, etc.)
    } else {
      console.log(
        `[Beecomm] pushOrder SUCCESS: orderNumber=${resp.orderNumber}, message=${resp.message}`
      );
    }
  } catch (err) {
    console.error("[Beecomm] pushOrderExample error:", err);
    process.exit(1);
  }
}

main();
```

Run it with:

```bash
node src/pushOrderExample.js
```

> ⚠️ Use this only in a test/sandbox environment or with small demo orders until you are confident the integration is correct.

---

## 7. Optional TypeScript Types (for Cursor)

If you want Cursor to work with **real TypeScript interfaces**, you can add a file `src/types.d.ts` with minimal types and let JS code reference them via JSDoc or import them into a TS project later.

Example:

```ts
// src/types.d.ts

export interface BeecommAccessListBranch {
  id: string;
  name: string;
}

export interface BeecommAccessListRestaurant {
  restaurantId: string;
  restaurantName: string;
  branches: BeecommAccessListBranch[];
}

export interface BeecommAccessListResponse {
  result: boolean;
  request_id: string;
  access_list: BeecommAccessListRestaurant[];
}

export interface BeecommDish {
  dishId: string;
  name: string;
  price: number;
  isCombo?: boolean;
  [key: string]: any;
}
```

You can then convert `beecommClient.js` and the example files to `.ts` and use these interfaces directly. The logic remains identical to the JS version.

---

## 8. How Cursor / LLM Can Use This README

This `README.md` is structured so tools like **Cursor** (or any LLM) can:

1. Understand the **high-level flow** (auth → access list → menu → order).
2. See the **exact endpoints and payloads** the client uses.
3. Copy-paste starter code for:
   - Authentication (`getAccessToken`)
   - Fetching a menu (`getMenu`)
   - Pushing orders (`pushOrder`)
4. Extend the examples to:
   - Implement menu syncing to a database
   - Build validated order payloads from a frontend
   - Add more robust error handling and logging

You can now:

- Plug these examples into your existing Node.js server, or  
- Use them as reference for generating additional code with Cursor/other LLM tools.

If you tell me which part you want to productionize next (menu sync, order validation, payment integration, etc.), I can generate more specific modules around this client.
