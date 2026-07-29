import { db } from "../db/client.js";

export type CommunicationChannel = "whatsapp" | "whatsapp_business" | "email" | "sms" | "share_pdf";
export type CommunicationStatus = "sent" | "failed";

export interface CommunicationLogEntry {
  id: number;
  bill_no: number;
  customer_code: string | null;
  mobile_number: string | null;
  channel: CommunicationChannel;
  status: CommunicationStatus;
  remarks: string | null;
  created_at: string;
}

export interface CommunicationLogInput {
  bill_no: number;
  customer_code?: string | null;
  mobile_number?: string | null;
  channel: CommunicationChannel;
  status: CommunicationStatus;
  remarks?: string | null;
}

export const communicationLogRepo = {
  record(input: CommunicationLogInput): CommunicationLogEntry {
    const result = db
      .prepare(
        "INSERT INTO communication_log (bill_no, customer_code, mobile_number, channel, status, remarks) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.bill_no,
        input.customer_code ?? null,
        input.mobile_number ?? null,
        input.channel,
        input.status,
        input.remarks ?? null,
      );
    return db
      .prepare("SELECT * FROM communication_log WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as unknown as CommunicationLogEntry;
  },

  listByBill(billNo: number): CommunicationLogEntry[] {
    // `id DESC` as the tiebreaker, not just created_at — datetime('now') only has one-second
    // resolution, so two sends in the same second would otherwise sort in an unspecified order.
    return db
      .prepare("SELECT * FROM communication_log WHERE bill_no = ? ORDER BY created_at DESC, id DESC")
      .all(billNo) as unknown as CommunicationLogEntry[];
  },

  list(limit = 200): CommunicationLogEntry[] {
    return db
      .prepare("SELECT * FROM communication_log ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(limit) as unknown as CommunicationLogEntry[];
  },
};
