# Customer reporting styles

Prepared for a later release; do not deploy this branch until the planned release window.

- Existing customer rows receive `report_style = legacy` when the additive schema migration first runs. No joined date is used to guess customer age.
- New customers created through the application default to `modern`. Future FoxPro CUSTOMER.DBF imports explicitly retain `legacy`. Existing imported accounts are skipped by the importer, preserving any customer opt-in.
- Customers can change My reporting style on My reports. The setting is saved against the authenticated customer's code. Owners and super admins can also change it under Customer Master.
- Bill Report → Customer Statement (Credit) selects that customer's saved default. Staff may choose either style for an individual report without changing the saved default.
- Legacy credit statements render the existing CWS/CWSWO/CWSG/CWSGWO fixed-width pages. Modern statements show tables, summaries, and vehicle subtotals. Both remain available for every customer.
- Mileage reports use the same authorized records in either layout. Modern Print / Save PDF prints the modern table; Download legacy PDF retains the existing fixed-width document.
- Styling never changes bills, receipts, balances, or ownership restrictions.

## Release order

1. Merge this prepared change when ready.
2. Pull master on the deployment computer and deploy `flyctl deploy --remote-only -a petropro-api` from the repository root. The schema migration is additive and preserves preferences on later restarts.
3. Deploy the matching commit to the existing PetroPro Vercel project.
4. Verify an existing customer starts in Legacy, a newly created customer starts in Modern, and an existing customer can opt in and retain Modern after sign-out/sign-in. Verify staff default and one-off overrides as well.

If rolling back the application, retain the new column; earlier code ignores it. Do not drop or reset reporting preferences.
