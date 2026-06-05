-- Sample data for local development of the events service.
-- Safe to re-run: uses INSERT ... ON DUPLICATE KEY UPDATE on (restaurant_slug, slug).

INSERT INTO events
  (restaurant_slug, slug, status, title, subtitle, summary, body_html,
   hero_image_url, location, starts_at, ends_at, price, cta_label, cta_url, lang, published_at)
VALUES
  ('eatalia', 'truffle-night', 'published',
   'Truffle Night', 'An evening dedicated to the white truffle',
   'A five-course tasting menu celebrating the season''s white truffle, paired with Piedmont wines.',
   '<p>Join us for a special evening as our chef builds a five-course menu around the prized white truffle.</p><p>Limited seating — reservations required.</p>',
   'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=1200',
   'Eatalia, Tel Aviv',
   '2026-07-12 20:00:00', '2026-07-12 23:00:00',
   '₪320', 'Reserve a table', 'https://allegrogruppo.com/eatalia', 'en',
   '2026-06-01 09:00:00'),

  ('la-braza', 'summer-grill', 'published',
   'Summer Grill Festival', 'Open-fire cooking all weekend',
   'A weekend of open-fire cooking, live music and a special grill menu.',
   '<p>Three days of open-fire cooking, live music, and a special grill menu crafted for the summer.</p>',
   'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=1200',
   'La Braza',
   '2026-08-01 18:00:00', '2026-08-03 23:00:00',
   'From ₪90', 'See the menu', 'https://allegrogruppo.com/la-braza', 'he',
   '2026-06-02 09:00:00')
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  status = VALUES(status),
  summary = VALUES(summary),
  updated_at = CURRENT_TIMESTAMP;
