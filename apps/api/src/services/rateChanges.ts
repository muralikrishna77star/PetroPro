import { rateChangesRepo, type RateChange } from "../repositories/rateChanges.js";
import { itemsRepo } from "../repositories/items.js";
import { todayDateOnly } from "../repositories/stock.js";

/** Applies every scheduled rate change due by `date` (default today) to its item's retail
 *  price. Legacy RATECHG: a scheduled price revision keyed by SCHED_ON effective date. */
export function applyDueRateChanges(date: string = todayDateOnly()): RateChange[] {
  const due = rateChangesRepo.dueOn(date);
  for (const change of due) {
    itemsRepo.updateRetailRate(change.item_code, change.rate);
    rateChangesRepo.markApplied(change.id);
  }
  return due;
}
