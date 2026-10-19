-- VETCO bot: catalog, sessions, orders.

CREATE TABLE products (
  id             TEXT PRIMARY KEY,               -- slug: bistrepen
  sort           INTEGER NOT NULL DEFAULT 0,
  category       TEXT NOT NULL,                  -- slug: antibiotik
  category_uz    TEXT,
  category_ru    TEXT,
  name           TEXT NOT NULL,
  name_ru        TEXT,
  maker          TEXT,
  form_uz        TEXT,
  form_ru        TEXT,
  ingredient     TEXT,
  description_uz TEXT,
  description_ru TEXT,
  dose_uz        TEXT,
  dose_ru        TEXT,
  dose_verified  INTEGER NOT NULL DEFAULT 0,     -- dose is shown only when 1
  unit_uz        TEXT,
  unit_ru        TEXT,
  price          INTEGER,                        -- so'm; NULL = price on request
  in_stock       INTEGER NOT NULL DEFAULT 1,
  active         INTEGER NOT NULL DEFAULT 1,
  photo_url      TEXT,
  alternatives   TEXT,                           -- comma separated product ids
  updated_at     TEXT NOT NULL
);
CREATE INDEX products_category ON products (category, sort);

-- Photos uploaded through the bot (/photo <id>); kept apart so catalog sync never drops them.
CREATE TABLE product_photos (
  product_id TEXT PRIMARY KEY,
  file_id    TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  chat_id    INTEGER PRIMARY KEY,
  lang       TEXT,
  step       TEXT,
  cart       TEXT NOT NULL DEFAULT '[]',         -- [{"id":"bistrepen","qty":2}]
  draft      TEXT NOT NULL DEFAULT '{}',         -- checkout fields being collected
  updated_at TEXT NOT NULL
);

-- Contact details remembered for repeat orders.
CREATE TABLE customers (
  chat_id    INTEGER PRIMARY KEY,
  username   TEXT,
  name       TEXT,
  phone      TEXT,
  region     TEXT,
  address    TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id          INTEGER NOT NULL,
  username         TEXT,
  lang             TEXT NOT NULL,
  customer_name    TEXT NOT NULL,
  phone            TEXT NOT NULL,
  region           TEXT NOT NULL,
  address          TEXT NOT NULL,
  note             TEXT,
  items            TEXT NOT NULL,                -- JSON snapshot of the cart at confirmation
  total            INTEGER,                      -- NULL when an item has no price
  status           TEXT NOT NULL DEFAULT 'new',  -- new|confirmed|shipped|delivered|cancelled
  admin_message_id INTEGER,
  sheets_synced    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX orders_chat ON orders (chat_id, id);
CREATE INDEX orders_status ON orders (status, id);
-- The 15-minute cron looks only for these rows; without partial indexes it would scan the table.
CREATE INDEX orders_unnotified ON orders (id) WHERE admin_message_id IS NULL;
CREATE INDEX orders_unsynced ON orders (id) WHERE sheets_synced = 0;

-- Operators' chat message -> customer chat, so an operator's reply reaches the customer.
-- Message ids are unique only inside one chat, hence the chat id in the key.
CREATE TABLE relay (
  admin_chat_id    TEXT NOT NULL,
  admin_message_id INTEGER NOT NULL,
  chat_id          INTEGER NOT NULL,
  order_id         INTEGER,
  kind             TEXT NOT NULL,                -- in: customer message header, copy: copied media, card: order card
  media_group      TEXT,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (admin_chat_id, admin_message_id)
);
CREATE INDEX relay_chat ON relay (chat_id, kind, created_at);
CREATE INDEX relay_created ON relay (created_at);

-- Telegram may deliver an update twice; the first insert wins.
CREATE TABLE processed_updates (
  update_id  INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE INDEX processed_updates_created ON processed_updates (created_at);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
