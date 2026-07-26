# PetroPro — Entity Relationship Diagram

Modern consolidated schema (the legacy per-month tables are merged into date-stamped tables).

```mermaid
erDiagram
    GROUPS ||--o{ ITEMS : categorizes
    ITEMS  ||--o{ BILL_LINES : "sold on"
    ITEMS  ||--o{ STOCK_DAYBOOK : "tracked in"
    ITEMS  ||--o{ PURCHASES : "purchased as"
    ITEMS  ||--o{ RATE_CHANGES : "repriced by"

    CUSTOMERS ||--o{ VEHICLES : owns
    CUSTOMERS ||--o{ FLEET_CARDS : holds
    CUSTOMERS ||--o{ BILLS : "billed to"
    CUSTOMERS ||--o{ RECEIPTS : pays
    CUSTOMERS ||--o{ OPENING_BALANCES : "starts with"
    CUSTOMERS ||--o{ LEDGER_ENTRIES : "accrues"

    USERS ||--o{ BILLS : "created by"
    USERS ||--o{ PENDING_TRANSACTIONS : captures
    USERS ||--o{ AUDIT_LOGS : performs
    USERS ||--o{ SHIFTS : works

    BILLS ||--|{ BILL_LINES : contains
    BILLS ||--o| MILEAGE_LOG : records
    VEHICLES ||--o{ BILL_LINES : "fuelled"
    VEHICLES ||--o{ PENDING_TRANSACTIONS : "fuelled"

    PENDING_TRANSACTIONS }o--|| ITEMS : "fuel item"
    PENDING_TRANSACTIONS ||--o| BILLS : "settled into"

    GROUPS {
        string code PK
        string name
    }
    ITEMS {
        string code PK
        string name
        string group_code FK
        number price_retail
        number price_wholesale
        number tax_percent
        bool   track_mileage
    }
    CUSTOMERS {
        string code PK
        string name
        number due_amount
        number credit_limit
        number service_charge
        string gst_no
    }
    VEHICLES {
        string vehicle_no PK
        string customer_code FK
        string fleet_card
    }
    USERS {
        string user_id PK
        string name
        string password_hash
        string role
    }
    BILLS {
        int    bill_no PK
        date   bill_date
        string vehicle_no FK
        string customer_code FK
        string user_id FK
        number sub_total
        number tax_total
        number grand_total
        string payment_type
        string status
    }
    BILL_LINES {
        int    id PK
        int    bill_no FK
        string item_code FK
        number qty
        number rate
        number amount
        number tax_percent
        number tax_amount
    }
    PENDING_TRANSACTIONS {
        int    id PK
        string vehicle_no
        string item_code FK
        number qty
        number amount
        number odometer
        string attendant_id FK
        string status
        int    bill_no FK
    }
    STOCK_DAYBOOK {
        string item_code FK
        date   sdate
        number opening
        number receipts
        number damaged
        number sales
        number closing
        number balance
    }
    RECEIPTS {
        int    rec_no PK
        date   rec_date
        string customer_code FK
        number amount
        string mode
    }
    PURCHASES {
        int    id PK
        string item_code FK
        number qty
        number value
        date   pur_date
    }
    RATE_CHANGES {
        int    id PK
        string item_code FK
        number rate
        date   scheduled_on
        bool   applied
    }
```

## Key relationships

- **Bill → Bill lines (1:N):** a bill groups one or more item lines under a `bill_no`. Legacy stored
  only lines; PetroPro adds an explicit `bills` header carrying totals & payment.
- **Pending transaction → Bill (0..1):** an attendant entry becomes exactly one settled bill line
  when the cashier accepts payment (the new attendant→cashier flow).
- **Customer → Ledger:** `opening_balances` + `bills` (debit) + `receipts` (credit) roll into
  `ledger_entries` and the running `customers.due_amount`.
- **Item → Stock daybook:** every fuel sale decrements `sales`/`balance`; purchases increment
  `receipts`.
