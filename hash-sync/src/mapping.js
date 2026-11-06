// Which Hashavshevet tables get a clean table, and how their columns map.
// Every source column not listed under `columns` goes to the target's `extra` JSON, so nothing is dropped.
// A source table not listed here goes to `source_rows` whole.
//
// year: 'master' = one copy in every open year; a column name = the year of that date;
//       { parent, via } = the year of the row with that key in the parent target table.
// enums: value maps for columns stored as words (the reverse is used to rebuild the source row).

// Passwords and login tokens are the one exception to "nothing is dropped" (owner's decision, 2026-11-06). They are not data
// for reports, and they stay in Hashavshevet and its backups. source_columns lists them with target_table 'not_copied'.
export const NOT_COPIED = {
  Users: ['Password'],
  Accounts: ['AccPass', 'SbstrToken'],
  CompanyDefs: ['Token', 'ExToken', 'IncomeTaxToken', 'ClientIDToken', 'CustomerToken',
    'TaxCustToken1', 'TaxRefreshToken1', 'TaxCustToken2', 'TaxRefreshToken2'],
};

export const CORE_TABLES = [
  {
    source: 'AccSortNames', target: 'account_groups', year: 'master', key: ['group_id'],
    columns: { group_id: 'ID', group_code: 'AccSortCode', name: 'SortCodeName' },
  },
  {
    source: 'Accounts', target: 'accounts', year: 'master', key: ['account_id'],
    columns: {
      account_id: 'ID', account_key: 'AccountKey', name: 'FullName', group_code: 'SortGroup', balance_code: 'BalanceCode',
      main_account: 'MainAccount', cost_code: 'CostCode', tax_file_num: 'TaxFileNum', address: 'Address', city: 'City',
      phone: 'Phone', email: 'EMail', bank_code: 'BankCode', bank_branch: 'BranchCode', bank_account: 'BankAccount',
      deduction_pct: 'DeductionPrc', deduction_valid_to: 'DeductionValid', stored_balance: 'Balance',
    },
  },
  {
    source: 'CostCodes', target: 'cost_centers', year: 'master', key: ['cost_center_id'],
    columns: { cost_center_id: 'CostCodeID', cost_code: 'CostCode', name: 'CostCodeName' },
  },
  {
    source: 'TransTypes', target: 'transaction_types', year: 'master', key: ['type_id'],
    columns: { type_id: 'TransTypeID', type_code: 'TransTypeCode', name: 'TransTypeName' },
  },
  {
    source: 'Bach', target: 'batches', year: 'master', key: ['batch_id'],
    columns: { batch_id: 'ID', batch_no: 'BachNo', batch_date: 'DatF', details: 'Details' },
  },
  {
    source: 'JurnalTrans', target: 'journal_entries', year: 'ValueDate', key: ['trans_id'],
    columns: {
      trans_id: 'TransID', batch_no: 'BatchNo', status: 'Status', trans_type: 'TransType', debit_account: 'TransDebID',
      credit_account: 'TransCredID', debit_name: 'DebName', credit_name: 'CredName', amount: 'suF', amount_fx: 'suFDlr',
      currency: 'CurrencyCode', value_date: 'ValueDate', due_date: 'DueDate', third_date: 'DatF3', issue_date: 'IssueDate',
      reference: 'Referance', reference2: 'Ref2', reference3: 'Ref3', description: 'Description', details: 'Details',
      cost_code: 'CostCode', document_id: 'StockID', cheque_id: 'CKID', tax_alloc_number: 'TaxApiNumber',
    },
  },
  {
    source: 'JurnalTransMoves', target: 'journal_lines', year: { parent: 'journal_entries', via: 'TransID' }, key: ['line_id'],
    columns: { line_id: 'ID', trans_id: 'TransID', account_key: 'AccountKey', side: 'DebitCredit', amount: 'SuF' },
    enums: { side: { 0: 'credit', 1: 'debit' } },
  },
  {
    source: 'BankPages', target: 'bank_lines', year: 'DatF', key: ['bank_line_id'],
    columns: {
      bank_line_id: 'ID', account_key: 'AccountKey', line_date: 'DatF', second_date: 'SecDate', reference: 'Reference',
      details: 'Details', direction: 'CreditDebit', amount: 'SuF', running_balance: 'Ballance', is_matched: 'Recon',
      match_num: 'Reconno', page_no: 'PageNo',
    },
    enums: { direction: { 0: 'in', 1: 'out' } },
  },
  {
    source: 'BankJurnalMatch', target: 'bank_matches', year: 'RDate', key: ['bank_match_id'],
    columns: {
      bank_match_id: 'ID', account_key: 'AccountKey', match_num: 'MatchNum', side: 'TabNum', linked_id: 'TransID',
      matched_on: 'RDate', matched_by: 'RUseFID',
    },
    enums: { side: { 0: 'book', 1: 'bank' } },
  },
  {
    source: 'ReceiptJurnalMatch', target: 'ledger_matches', year: 'RDate', key: ['ledger_match_id'],
    columns: {
      ledger_match_id: 'ID', journal_line_id: 'JurnalTransID', match_num: 'MatchNum', amount: 'SuF', currency: 'CurrencyCode',
      is_full_match: 'FullMatch', document_id: 'StockId', reference: 'Reference', matched_on: 'RDate', matched_by: 'RUseFID',
    },
  },
  {
    source: 'Stock', target: 'documents', year: 'ValueDate', key: ['document_id'],
    columns: {
      document_id: 'ID', document_type: 'DocumentID', doc_number: 'DocNumber', status: 'Status', account_key: 'AccountKey',
      account_name: 'AccountName', value_date: 'ValueDate', due_date: 'DueDate', total: 'TFtal', total_vat_free: 'TFtalVatFree',
      total_vat: 'TFtalVat', vat_pct: 'VatPrc', reference: 'Reference', cost_code: 'CostCode', tax_alloc_number: 'TaxApiNumber',
    },
  },
  {
    source: 'StockMoves', target: 'document_lines', year: { parent: 'documents', via: 'StockID' }, key: ['document_line_id'],
    columns: {
      document_line_id: 'ID', document_id: 'StockID', line_num: 'LineNum', item_key: 'ItemKey', item_name: 'ItemName',
      quantity: 'Quantity', price: 'Price', total: 'TFtal', vat_pct: 'VatPrc', cost_code: 'CostCode', journal_account: 'JurnalAcc',
    },
  },
  {
    source: 'CKSumToPay', target: 'cheques', year: 'OriginalDate', key: ['cheque_id'],
    columns: {
      cheque_id: 'CKID', account_key: 'AccountKey', payee_name: 'FullName', amount_to_pay: 'SuFOfToPay', paid: 'pay',
      deducted: 'diduct', due_date: 'DueDate', original_date: 'OriginalDate', issue_date: 'IssueDate', status: 'Status',
      reference: 'Reference', bank_key: 'BankKey',
    },
  },
  {
    source: 'Maam874Moves', target: 'vat_lines', year: 'ValueDate', key: ['vat_line_id'],
    columns: {
      vat_line_id: 'ID', issue_id: 'IssueID', trans_id: 'JurnalTransID', record_type: 'RecSimbol', value_date: 'ValueDate',
      reference: 'Reference', amount: 'Suf', base_amount: 'MoreSuf2', account_key: 'AccountKey', tax_file_num: 'AccFileNum',
      debit_credit: 'DebitCredit', tax_alloc_number: 'TaxApiNumber',
    },
  },
];
