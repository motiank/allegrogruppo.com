-- Joya HQ keeps no locations table any more (2026-10-24): a location id IS the Allegro branch id,
-- and name, company and the list of branches come from the Allegro API /branches.
--
-- Run ONCE on a DB that has the old joya_locations table (a development DB made with an older
-- add-joya.sql). A new DB made with the current add-joya.sql needs nothing. Every location_id
-- becomes the branch id of its old link row; rows of a location that had no branch are left with
-- the old number (they were hidden before and stay hidden). Then joya_locations is dropped.

ALTER TABLE joya_audit_log MODIFY location_id VARCHAR(64) NULL;
UPDATE joya_audit_log x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
ALTER TABLE joya_import_batches MODIFY location_id VARCHAR(64) NULL;
UPDATE joya_import_batches x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
ALTER TABLE joya_menu_items MODIFY location_id VARCHAR(64) NOT NULL;
UPDATE joya_menu_items x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
ALTER TABLE joya_attendance_corrections MODIFY location_id VARCHAR(64) NULL;
UPDATE joya_attendance_corrections x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
ALTER TABLE joya_payroll_issues MODIFY location_id VARCHAR(64) NOT NULL;
UPDATE joya_payroll_issues x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
ALTER TABLE joya_shortages MODIFY location_id VARCHAR(64) NOT NULL;
UPDATE joya_shortages x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
ALTER TABLE joya_order_lists MODIFY location_id VARCHAR(64) NOT NULL;
UPDATE joya_order_lists x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
ALTER TABLE joya_item_patterns MODIFY location_id VARCHAR(64) NOT NULL;
UPDATE joya_item_patterns x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
ALTER TABLE joya_shift_defs MODIFY location_id VARCHAR(64) NOT NULL;
UPDATE joya_shift_defs x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
ALTER TABLE joya_staffing_rules MODIFY location_id VARCHAR(64) NULL;
UPDATE joya_staffing_rules x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
ALTER TABLE joya_staffing_baseline MODIFY location_id VARCHAR(64) NOT NULL;
UPDATE joya_staffing_baseline x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
ALTER TABLE joya_staffing_plans MODIFY location_id VARCHAR(64) NOT NULL;
UPDATE joya_staffing_plans x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
ALTER TABLE joya_tasks MODIFY location_id VARCHAR(64) NULL;
UPDATE joya_tasks x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
ALTER TABLE joya_inquiries MODIFY location_id VARCHAR(64) NULL;
UPDATE joya_inquiries x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
ALTER TABLE joya_ai_requests MODIFY location_id VARCHAR(64) NULL;
UPDATE joya_ai_requests x JOIN joya_locations l ON l.id = x.location_id SET x.location_id = l.allegro_branch_id WHERE l.allegro_branch_id IS NOT NULL;
DROP TABLE joya_locations;
