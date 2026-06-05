# Events service (`events.allegrogruppo.com`)

Server-side-rendered landing pages for events across the Allegro Gruppo
restaurant network. This service is **read-only**: it renders published events
from the database. Creating and managing events will be handled by the **admin**
backend (built separately, later).

Why SSR? Event links are shared on WhatsApp / Facebook / Google, so every page
ships proper `<title>`, `description`, canonical and Open Graph / Twitter card
meta tags filled from the database — which client-rendered SPAs do poorly.

## Layout

```
events/
├── server/
│   ├── server.js              # Express entry point (port 3023)
│   ├── modules/
│   │   └── events.js          # routes + DB queries (HTML pages + JSON API)
│   ├── render/
│   │   ├── templates.js       # SSR HTML templates (event page, list, 404)
│   │   └── html.js            # escaping + base-URL helpers
│   └── sources/
│       └── dbpool.js          # MySQL pool (mirrors admin/order_sys)
├── public/
│   └── css/events.css         # base styles
├── schema/
│   ├── events.sql             # `events` table DDL
│   └── seed.sql               # sample dev data
├── scripts/
│   └── apply-schema.js        # create table (+ optional --seed)
└── README.md
```

## URLs

| Route                         | Description                          |
| ----------------------------- | ------------------------------------ |
| `/:restaurant`                | Listing of published events (HTML)   |
| `/:restaurant/:slug`          | Single event landing page (HTML)     |
| `/api/events/:restaurant`     | Published events (JSON)              |
| `/api/events/:restaurant/:slug` | Single event (JSON)                |
| `/health`                     | Health check                         |

`:restaurant` is the project-wide restaurant slug (`eatalia`, `la-braza`,
`pasta-lina`, … — see `admin/server/modules/allegro.js`).

Example: `https://events.allegrogruppo.com/eatalia/truffle-night`

## Setup

The service reuses the repo's root `.env` (same DB credentials as admin /
order_sys). Optional events-specific variables:

```bash
EVENTS_PORT=3023                               # default 3023
EVENTS_CORS_ORIGIN=http://localhost:5173       # for the admin panel / previews
EVENTS_PUBLIC_URL=https://events.allegrogruppo.com  # canonical/OG base URL behind a proxy
```

Create the table (and load sample data):

```bash
node events/scripts/apply-schema.js --seed
```

## Run

From the repo root:

```bash
npm run events       # production-style
npm run eventsDev    # development (EVENTS_PORT=3023, NODE_ENV=development)
```

Then visit <http://localhost:3023/eatalia> (after seeding).

## Notes / next steps

- `body_html` is rendered as raw HTML and is treated as **trusted** content
  authored via the admin backend. If untrusted input is ever allowed, sanitize it.
- The admin write-side (CRUD for events, image uploads, publishing) is not part
  of this skeleton.
- Deployment: point `events.allegrogruppo.com` at this service (port 3023).
