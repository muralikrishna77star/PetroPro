import { receiptsRepo, type Receipt, type ReceiptInput } from "../repositories/receipts.js";
import { openingBalancesRepo, type OpeningBalance } from "../repositories/openingBalances.js";
import { customersRepo } from "../repositories/customers.js";

/** Records a customer payment (legacy RECEIPTS) and reduces their running due amount by the
 *  amount collected. `service_charge` is stored for record-keeping only — not applied to the
 *  due amount, since the legacy SC_AMT semantics (bounced-cheque fee vs. collection charge)
 *  aren't pinned down; revisit if that turns out to matter. */
export function recordReceipt(input: ReceiptInput): Receipt {
  const customer = customersRepo.get(input.customer_code);
  if (!customer) throw new Error(`Unknown customer code: ${input.customer_code}`);
  if (input.amount <= 0) throw new Error("Receipt amount must be positive");

  const receipt = receiptsRepo.create(input);
  customersRepo.adjustDueAmount(input.customer_code, -input.amount);
  return receipt;
}

/** Sets a customer's opening balance (legacy OP_BAL) as of a date and establishes it as the
 *  customer's current due amount — intended as a one-time starting point (onboarding/
 *  migration), not a running adjustment. */
export function setOpeningBalance(input: OpeningBalance): OpeningBalance {
  const customer = customersRepo.get(input.customer_code);
  if (!customer) throw new Error(`Unknown customer code: ${input.customer_code}`);

  const balance = openingBalancesRepo.set(input);
  customersRepo.setDueAmount(input.customer_code, input.op_balance);
  return balance;
}
