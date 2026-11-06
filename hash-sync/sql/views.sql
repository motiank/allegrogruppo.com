-- Report views for the first use cases. All of them leave out rows flagged with deleted_at.
-- Filter them by company_id and fiscal_year (or by date for a period).

-- Use cases 12, 13: every journal line with its entry and account. `posted` = 1 for posted entries.
CREATE OR REPLACE VIEW v_journal AS
SELECT l.company_id, l.fiscal_year, l.line_id, l.trans_id, e.batch_no, (e.status = 1) AS posted, e.trans_type,
       e.value_date, e.due_date, e.reference, e.description, e.cost_code,
       l.account_key, a.name AS account_name, a.group_code, g.name AS group_name,
       l.side, l.amount, l.signed_amount
FROM journal_lines l
JOIN journal_entries e ON e.company_id = l.company_id AND e.fiscal_year = l.fiscal_year AND e.trans_id = l.trans_id
LEFT JOIN accounts a ON a.company_id = l.company_id AND a.fiscal_year = l.fiscal_year AND a.account_key = l.account_key
LEFT JOIN account_groups g ON g.company_id = a.company_id AND g.fiscal_year = a.fiscal_year AND g.group_code = a.group_code
WHERE l.deleted_at IS NULL AND e.deleted_at IS NULL;

-- Use case 11: movement per account per year, posted entries only.
CREATE OR REPLACE VIEW v_trial_balance AS
SELECT company_id, fiscal_year, account_key, account_name, group_code, group_name,
       SUM(IF(side = 'debit', amount, 0)) AS debit, SUM(IF(side = 'credit', amount, 0)) AS credit,
       SUM(signed_amount) AS balance
FROM v_journal
WHERE posted = 1
GROUP BY company_id, fiscal_year, account_key, account_name, group_code, group_name;

-- Use case 16: customer invoices and credit notes. A credit note is minus.
CREATE OR REPLACE VIEW v_customer_invoices AS
SELECT e.company_id, e.fiscal_year, e.trans_id, e.trans_type, e.reference AS doc_number, e.value_date,
       a.account_key, a.name AS customer_name,
       IF(e.trans_type = 'חז', -e.amount, e.amount) AS gross_amount, (e.status = 1) AS posted
FROM journal_entries e
JOIN accounts a ON a.company_id = e.company_id AND a.fiscal_year = e.fiscal_year
 AND a.account_key = IF(e.trans_type = 'חז', e.credit_account, e.debit_account)
WHERE e.trans_type IN ('ע', 'חז') AND e.deleted_at IS NULL;

-- Use case 14: bank lines not matched yet.
CREATE OR REPLACE VIEW v_bank_open_bank AS
SELECT company_id, fiscal_year, account_key, bank_line_id, line_date, reference, details, direction, amount, signed_amount,
       DATEDIFF(CURRENT_DATE, line_date) AS age_days
FROM bank_lines
WHERE is_matched = 0 AND deleted_at IS NULL;

-- Use case 14: book lines of a bank account not matched yet.
CREATE OR REPLACE VIEW v_bank_open_book AS
SELECT j.company_id, j.fiscal_year, j.account_key, j.line_id, j.trans_id, j.value_date, j.reference, j.description,
       j.side, j.amount, j.signed_amount, DATEDIFF(CURRENT_DATE, j.value_date) AS age_days
FROM v_journal j
WHERE j.account_key IN (SELECT DISTINCT b.account_key FROM bank_lines b WHERE b.company_id = j.company_id)
  AND NOT EXISTS (SELECT 1 FROM bank_matches m WHERE m.company_id = j.company_id AND m.side = 'book'
                  AND m.linked_id = j.line_id AND m.deleted_at IS NULL);

-- Use case 14: reconciliation summary, all years together per bank account.
CREATE OR REPLACE VIEW v_bank_reconciliation AS
SELECT b.company_id, b.account_key, b.bank_balance, b.bank_open, k.book_balance, k.book_open,
       b.bank_balance - b.bank_open AS bank_matched, k.book_balance - k.book_open AS book_matched
FROM (SELECT company_id, account_key, SUM(signed_amount) AS bank_balance,
             SUM(IF(is_matched = 0, signed_amount, 0)) AS bank_open
      FROM bank_lines WHERE deleted_at IS NULL GROUP BY company_id, account_key) b
JOIN (SELECT j.company_id, j.account_key, SUM(j.signed_amount) AS book_balance,
             SUM(IF(m.linked_id IS NULL, j.signed_amount, 0)) AS book_open
      FROM v_journal j
      LEFT JOIN (SELECT DISTINCT company_id, linked_id FROM bank_matches WHERE side = 'book' AND deleted_at IS NULL) m
        ON m.company_id = j.company_id AND m.linked_id = j.line_id
      WHERE j.account_key IN (SELECT DISTINCT account_key FROM bank_lines)
      GROUP BY j.company_id, j.account_key) k
  ON k.company_id = b.company_id AND k.account_key = b.account_key;
