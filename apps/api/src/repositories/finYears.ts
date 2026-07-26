import { db } from "../db/client.js";

export interface FinYear {
  fin_year_start: string;
}

export const finYearsRepo = {
  get(): FinYear {
    return db.prepare("SELECT fin_year_start FROM fin_years WHERE id = 1").get() as unknown as FinYear;
  },

  set(finYearStart: string): FinYear {
    db.prepare("UPDATE fin_years SET fin_year_start = ? WHERE id = 1").run(finYearStart);
    return finYearsRepo.get();
  },
};
