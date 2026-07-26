import { shiftsRepo, type Shift } from "../repositories/shifts.js";

export function openShift(userId: string, openingCash: number): Shift {
  const existing = shiftsRepo.getOpenForUser(userId);
  if (existing) throw new Error(`User ${userId} already has an open shift (#${existing.id})`);
  return shiftsRepo.open(userId, openingCash);
}

export function closeShift(shiftId: number, closingCash: number, notes?: string): Shift {
  const shift = shiftsRepo.get(shiftId);
  if (!shift) throw new Error(`Shift ${shiftId} not found`);
  if (shift.status !== "open") throw new Error(`Shift ${shiftId} is already closed`);

  const cashSales = shiftsRepo.cashSalesSince(shift.user_id, shift.opened_at);
  const expectedCash = shift.opening_cash + cashSales;

  return shiftsRepo.close(shiftId, closingCash, expectedCash, notes) as Shift;
}
