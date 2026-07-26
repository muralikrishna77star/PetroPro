import { purchasesRepo, type Purchase, type PurchaseInput } from "../repositories/purchases.js";
import { itemsRepo } from "../repositories/items.js";
import { stockRepo, todayDateOnly } from "../repositories/stock.js";

/** Records a purchase, feeds the stock day-book's receipts bucket, and rolls the item's
 *  last purchase cost forward (legacy PUR_VAL semantics). */
export function recordPurchase(input: PurchaseInput): Purchase {
  const item = itemsRepo.get(input.item_code);
  if (!item) throw new Error(`Unknown item code: ${input.item_code}`);
  if (input.qty <= 0) throw new Error("Purchase quantity must be positive");

  const date = (input.pur_date ?? todayDateOnly()).slice(0, 10);
  stockRepo.applyReceipt(input.item_code, input.qty, date);

  const purchase = purchasesRepo.create(input);
  const unitValue = input.value / input.qty;
  itemsRepo.updatePurchaseValue(input.item_code, unitValue);

  return purchase;
}
