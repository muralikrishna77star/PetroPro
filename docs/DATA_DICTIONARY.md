# PetroPro — Data Dictionary

Reverse-engineered from the legacy FoxPro 2.6 DBF tables in `legacy/Workarea/`. Field notation:
`type len[,dec]` where C=Character, N=Numeric, D=Date, L=Logical, M=Memo.

The legacy design splits transactions into **per-month, per-financial-year tables** (e.g. `JANBIL18`,
`FEBBIL18` … where `18` = FY 2018-19). The modern schema consolidates these into single tables with
proper date columns and a `fin_year` dimension.

---

## 1. Master / catalog

### GROUP (`GROUP.DBF`) → `groups`
Product groups (fuel, lubricant, accessory…).

| Legacy field | Type | Modern column | Notes |
| ------------ | ---- | ------------- | ----- |
| GROUP_CODE   | C1   | code (PK)     | single-char code |
| DESC         | C10  | name          |       |

### ITEM (`ITEM.DBF`) → `items`
Sellable items. Prices are stored both **before-tax** (`*BTX`) and **tax-inclusive** (`*TAX`) — fuel is
typically priced tax-inclusive.

| Legacy field | Type  | Modern column | Notes |
| ------------ | ----- | ------------- | ----- |
| ICODE        | C3    | code (PK)     |       |
| IDESC        | C30   | name          |       |
| IPRICEW      | N10,2 | price_wholesale | |
| IPRICER      | N10,2 | price_retail  |       |
| GROUP_CODE   | C1    | group_code (FK)| |
| PUR_VAL      | N5,2  | purchase_value | last purchase cost |
| MAGE         | C1    | track_mileage | Y/N — capture odometer |
| TAX_PER      | N8,2  | tax_percent   | GST % |
| IPRICEWBTX / IPRICEWTAX | N8,2 | price_wholesale_pretax / _tax | derived |
| IPRICERBTX / IPRICERTAX | N8,2 | price_retail_pretax / _tax | derived |
| PUR_VALBTX / PUR_VALTAX  | N8,2 | purchase_value_pretax / _tax | derived |
| —            | —     | hsn_code      | PWA-only, no legacy analog (FoxPro system predates GST). Optional; validated as 4/6/8 numeric digits per CBIC invoicing rules — see `services/hsn.ts` |

### PRODUCT (`PRODUCT.DBF`) → `products`
Alternate catalog with effective-dated pricing (kept for compatibility).

| PRODCODE C3 | PRODDESC C30 | RETPRICE N10,2 | WHPRICE N10,2 | PUR_VAL N10,2 | GROUP_CODE C1 | EFF_FROM D | EFF_TO D |

### CUSTOMER (`CUSTOMER.DBF`) → `customers`
Credit / fleet customers.

| Legacy field | Type   | Modern column | Notes |
| ------------ | ------ | ------------- | ----- |
| CUST_CODE    | C5     | code (PK)     |       |
| DOJ          | D      | joined_on     |       |
| NAME         | C25    | name          |       |
| ADDRESS      | C35    | address       |       |
| PRINT        | C15    | print_name    | short name on invoice |
| PHONE        | N10    | phone         |       |
| DUE_AMT      | N10,2  | due_amount    | running balance |
| CR_LMT       | N10,2  | credit_limit  |       |
| SER_CHG      | N10,5  | service_charge| % surcharge |
| TINNO        | C15    | tin_no        | legacy VAT TIN |
| GSTNO        | C20    | gst_no        |       |

### VEH_DET (`VEH_DET.DBF`) → `vehicles`
Vehicle registry (≈109k rows). Links a vehicle to a customer & optional fleet card.

| CUST_CODE C5 (FK) | VEH_NO C13 (PK) | FLEETCARD C16 |

### FLEETCARD (`FLEETCARD.DBF`) → `fleet_cards`
| CUST_CODE C5 (FK) | VEH_NO C13 |

---

## 2. Users & security

### USERTAB (`USERTAB.DBF`) → `users`
| USER_ID C10 (PK) | NAME C15 | PWD C50 (→ bcrypt hash) | DOC D (created) | LEVEL N1 → role |

`LEVEL`/`member` maps to roles: **1 = admin/manager**, **2 = cashier** (restricted — legacy hides many
admin menu bars with `skip for member=2`). Attendant is a new role introduced by the PWA.

### CASHIER (`CASHIER.DBF`) → `cashiers`
| CNAME C15 | CPASS C7 | CINIT C3 (initials, printed on bills) | DOJ D |

### MEMBERS (`MEMBERS.DBF`) → legacy login table (superseded by `users`).

---

## 3. Configuration

### SETTINGS (`SETTINGS.DBF`) → `settings` (key/value)
Known keys: `VERSION`, `KEROSENE`, `FLEETCARDENTRY`, `PRINTTESTMODE`, `PRINTSPECIALCHARACTERS`,
`BILLENTRY`, `WORKINGPATH`, `GSTNO`, `GSTNAMEADD`.

### HEADINGS (`HEADINGS.DBF`) → `company_profile`
| CNAME C40 (company) | ADDR1 C50 | ADDR2 C50 | ADDLINE C40 | (+ GSTNO from settings) |

### FIN_YEAR (`FIN_YEAR.DBF`) → `fin_years`
| FIN_YEAR D | — current/active financial year start. |

### BILLNO (`BILLNO.DBF`) → `bill_sequences`
| BILLNO N10 | TYPE C1 | — next bill number per bill type. |

---

## 4. Transactions (monthly tables → consolidated)

### `<MON>BIL<YY>` (e.g. `JANBIL18`) → `bill_lines`
One row per item on a bill.

| Legacy field | Type  | Modern column | Notes |
| ------------ | ----- | ------------- | ----- |
| BILL_NO      | N10   | bill_no       | groups lines into a bill |
| VEH_NO       | C13   | vehicle_no    |       |
| BILL_DATE    | D     | bill_date     |       |
| STATUS       | C1    | status        | e.g. active/cancelled |
| ICODE        | C3    | item_code (FK)| |
| QTY          | N9,3  | qty           | litres / units |
| RATE         | N10,2 | rate          | tax-inclusive unit rate |
| AMT          | N10,2 | amount        | line total |
| USER_ID      | C10   | user_id (FK)  | cashier |
| CUST_CODE    | C5    | customer_code | blank = cash sale |
| ONO          | N4    | order_no      | credit-bill order no |
| RETAIL       | N1    | is_retail     | retail vs wholesale flag |
| BTIME        | C10   | bill_time     |       |
| SER_CHG      | N10,5 | service_charge| |
| MAGE         | C1    | mileage_flag  |       |
| RATEBTX      | N8,2  | rate_pretax   |       |
| TAX_PER      | N8,2  | tax_percent   |       |
| UTAX_AMT     | N8,2  | unit_tax_amount | tax per unit |
| TAX_AMT      | N8,2  | tax_amount    | line tax total |

Modern model adds a `bills` header table (bill_no, date, customer, totals, payment) — in the legacy
system the header is implicit across the line rows.

### BILLCNCS (`BILLCNCS.DBF`) → `bill_lines` with status='C' (+ cancel audit)
Extra fields: CINIT, BCTIME (cancel time), CCINIT, CUSER_ID → cancellation audit columns.

### PREVBILL (`PREVBILL.DBF`) → transient "last bill" buffer (reprint).

### `<MON>STK<YY>` / STOCK → `stock_daybook`
| ICODE C3 | SDATE D | OSTOCK (opening) | CSTOCK (closing) | RECEIPTS | DAMAGED | SALES | BALANCE | (all N10,2) |

### MAGE / `MAGE<YY>` → `mileage_log`
| BILL_NO | STATUS | VEH_NO | ICODE | OR (odometer prev) N9,1 | CR (current) N9,1 | MILEAGE N6,2 |

### PURCH / `PURCH<YY>` → `purchases`
| ICODE C5 | QTY N10 | INVNO N10 | C_DDNO N10 | PUR_VALUE N10,2 | PUR_DATE D | CSR_AD C3 | VAT_AMT N10,2 |

### RECEIPTS / `RECPT<YY>` → `receipts`
| REC_NO N10 | REC_DATE D | CUST_CODE C5 | CSHORCHQ C2 (cash/cheque) | CHQNO N10 | BANKNAME C25 | AMOUNT N10,2 | SC_AMT N10,2 (service chg) | REC_TIME C8 | CSR_INIT C3 |

### OP_BAL (`OP_BAL.DBF`) → `opening_balances`
| CUST_CODE C5 | OP_DATE D | OP_BAL N13,2 |

### RATEFIL / RATECHG → `rate_changes`
`RATEFIL`: ICODE, RATE (current). `RATECHG`: full item snapshot + `SCHED_ON` D (effective date) +
`DEL` C1 (deleted flag) — scheduled price revisions.

### POSTING (`POSTING.DBF`) → `day_postings`
| POSTED_DT D | USER_ID C10 | POST_DATE D | POSTED_TM C10 | — records day-close postings. |

### LEDGER / DAYLEDG / MONLEDG → `ledger_entries`
Customer ledger: opening, debit (bills), credit (receipts), closing.

---

## 5. New (PWA-only) tables

| Table | Purpose |
| ----- | ------- |
| `pending_transactions` | attendant-captured fuel entries awaiting cashier settlement (vehicle, fuel item, qty/amount, odometer, attendant, status) |
| `shifts`               | attendant/cashier shift open/close, cash reconciliation |
| `audit_logs`           | user action audit trail |
| `sync_queue`           | offline mutations pending LAN/server sync |

See [ER_DIAGRAM.md](ER_DIAGRAM.md) for relationships and [MIGRATION_NOTES.md](MIGRATION_NOTES.md) for
DBF import rules.
