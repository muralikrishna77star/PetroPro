import { db } from "../db/client.js";
import { splitFromInclusive } from "../services/tax.js";

export interface Item {
  code: string;
  name: string;
  group_code: string | null;
  price_wholesale: number;
  price_retail: number;
  purchase_value: number;
  track_mileage: number;
  tax_percent: number;
  price_wholesale_pretax: number;
  price_wholesale_tax: number;
  price_retail_pretax: number;
  price_retail_tax: number;
  purchase_value_pretax: number;
  purchase_value_tax: number;
}

export interface ItemInput {
  code: string;
  name: string;
  group_code?: string | null;
  price_wholesale: number;
  price_retail: number;
  purchase_value: number;
  track_mileage?: boolean;
  tax_percent: number;
}

function deriveTaxFields(input: ItemInput) {
  const wholesale = splitFromInclusive(input.price_wholesale, input.tax_percent);
  const retail = splitFromInclusive(input.price_retail, input.tax_percent);
  const purchase = splitFromInclusive(input.purchase_value, input.tax_percent);
  return {
    price_wholesale_pretax: wholesale.pretax,
    price_wholesale_tax: wholesale.taxAmount,
    price_retail_pretax: retail.pretax,
    price_retail_tax: retail.taxAmount,
    purchase_value_pretax: purchase.pretax,
    purchase_value_tax: purchase.taxAmount,
  };
}

export const itemsRepo = {
  list(): Item[] {
    return db.prepare("SELECT * FROM items ORDER BY code").all() as unknown as Item[];
  },

  get(code: string): Item | undefined {
    return db.prepare("SELECT * FROM items WHERE code = ?").get(code) as Item | undefined;
  },

  create(input: ItemInput): Item {
    const derived = deriveTaxFields(input);
    db.prepare(
      `INSERT INTO items (
        code, name, group_code, price_wholesale, price_retail, purchase_value,
        track_mileage, tax_percent, price_wholesale_pretax, price_wholesale_tax,
        price_retail_pretax, price_retail_tax, purchase_value_pretax, purchase_value_tax
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.code,
      input.name,
      input.group_code ?? null,
      input.price_wholesale,
      input.price_retail,
      input.purchase_value,
      input.track_mileage ? 1 : 0,
      input.tax_percent,
      derived.price_wholesale_pretax,
      derived.price_wholesale_tax,
      derived.price_retail_pretax,
      derived.price_retail_tax,
      derived.purchase_value_pretax,
      derived.purchase_value_tax,
    );
    return itemsRepo.get(input.code) as Item;
  },

  update(code: string, input: Omit<ItemInput, "code">): Item | undefined {
    const derived = deriveTaxFields({ ...input, code });
    db.prepare(
      `UPDATE items SET
        name = ?, group_code = ?, price_wholesale = ?, price_retail = ?, purchase_value = ?,
        track_mileage = ?, tax_percent = ?, price_wholesale_pretax = ?, price_wholesale_tax = ?,
        price_retail_pretax = ?, price_retail_tax = ?, purchase_value_pretax = ?, purchase_value_tax = ?
      WHERE code = ?`,
    ).run(
      input.name,
      input.group_code ?? null,
      input.price_wholesale,
      input.price_retail,
      input.purchase_value,
      input.track_mileage ? 1 : 0,
      input.tax_percent,
      derived.price_wholesale_pretax,
      derived.price_wholesale_tax,
      derived.price_retail_pretax,
      derived.price_retail_tax,
      derived.purchase_value_pretax,
      derived.purchase_value_tax,
      code,
    );
    return itemsRepo.get(code);
  },

  /** Legacy PUR_VAL semantics: item master always carries the *last* purchase cost. */
  updatePurchaseValue(code: string, purchaseValue: number): Item | undefined {
    const item = itemsRepo.get(code);
    if (!item) return undefined;
    const split = splitFromInclusive(purchaseValue, item.tax_percent);
    db.prepare(
      `UPDATE items SET purchase_value = ?, purchase_value_pretax = ?, purchase_value_tax = ? WHERE code = ?`,
    ).run(purchaseValue, split.pretax, split.taxAmount, code);
    return itemsRepo.get(code);
  },

  /** Applies a scheduled rate change (rate_changes) to the item's retail price. */
  updateRetailRate(code: string, rate: number): Item | undefined {
    const item = itemsRepo.get(code);
    if (!item) return undefined;
    const split = splitFromInclusive(rate, item.tax_percent);
    db.prepare(
      `UPDATE items SET price_retail = ?, price_retail_pretax = ?, price_retail_tax = ? WHERE code = ?`,
    ).run(rate, split.pretax, split.taxAmount, code);
    return itemsRepo.get(code);
  },

  /** Bulk tax-rate revision (e.g. a GST rate change decree) — updates `tax_percent` and
   *  recomputes every derived before-tax/tax-inclusive field, optionally scoped to one group.
   *  Returns the updated items. */
  bulkUpdateTaxPercent(taxPercent: number, groupCode?: string): Item[] {
    const targets = groupCode
      ? itemsRepo.list().filter((i) => i.group_code === groupCode)
      : itemsRepo.list();

    for (const item of targets) {
      const derived = deriveTaxFields({
        code: item.code,
        name: item.name,
        price_wholesale: item.price_wholesale,
        price_retail: item.price_retail,
        purchase_value: item.purchase_value,
        tax_percent: taxPercent,
      });
      db.prepare(
        `UPDATE items SET
          tax_percent = ?, price_wholesale_pretax = ?, price_wholesale_tax = ?,
          price_retail_pretax = ?, price_retail_tax = ?, purchase_value_pretax = ?, purchase_value_tax = ?
        WHERE code = ?`,
      ).run(
        taxPercent,
        derived.price_wholesale_pretax,
        derived.price_wholesale_tax,
        derived.price_retail_pretax,
        derived.price_retail_tax,
        derived.purchase_value_pretax,
        derived.purchase_value_tax,
        item.code,
      );
    }

    return targets.map((item) => itemsRepo.get(item.code) as Item);
  },
};
