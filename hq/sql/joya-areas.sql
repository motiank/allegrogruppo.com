-- The main menu has three areas (stock and purchasing, manpower, performance), each with its own chat.
-- A chat question asked in an area is a joya_ai_requests row with context_kind 'AREA' and
-- context_id = the area (1 stock and purchasing, 2 manpower, 3 performance). Run once on an existing DB.
ALTER TABLE joya_ai_requests
  MODIFY context_kind ENUM('GENERAL','ORDER_LIST','STAFFING_PLAN','INQUIRY','AREA') NOT NULL DEFAULT 'GENERAL';
