import fs from "node:fs";

export type DbfFieldType = "C" | "N" | "F" | "D" | "L" | "M" | "T" | "I" | "B" | "Y";

export interface DbfField {
  name: string;
  type: DbfFieldType;
  length: number;
  decimals: number;
}

export interface DbfTable {
  fields: DbfField[];
  recordCount: number;
  headerSize: number;
  recordSize: number;
}

/** A parsed field value: string (C/M — memo pointers are not resolved, see below), number
 *  (N/F/I/B/Y), boolean (L), or an ISO date string "YYYY-MM-DD" (D) / null for a blank date. */
export type DbfValue = string | number | boolean | null;

export type DbfRow = Record<string, DbfValue>;

/**
 * Minimal FoxPro/dBase III+ .DBF reader — header + field descriptors + fixed-width records.
 * Deliberately does not resolve memo (M) fields via the companion .FPT file: none of the
 * master-data tables this importer targets (GROUP/ITEM/CUSTOMER/VEH_DET/USERTAB/FLEETCARD) use
 * memo fields (confirmed via legacy/dbf_schema.py). A memo field here comes back as the raw
 * 10-character block-pointer text, not the memo content.
 */
export function readDbfHeader(path: string): DbfTable {
  const fd = fs.openSync(path, "r");
  try {
    const header = Buffer.alloc(32);
    fs.readSync(fd, header, 0, 32, 0);
    const recordCount = header.readUInt32LE(4);
    const headerSize = header.readUInt16LE(8);
    const recordSize = header.readUInt16LE(10);

    const fields: DbfField[] = [];
    let offset = 32;
    const fieldBuf = Buffer.alloc(32);
    for (;;) {
      const bytesRead = fs.readSync(fd, fieldBuf, 0, 32, offset);
      if (bytesRead < 32 || fieldBuf[0] === 0x0d) break;
      const name = fieldBuf.toString("latin1", 0, 11).split("\0")[0].trim();
      const type = String.fromCharCode(fieldBuf[11]) as DbfFieldType;
      const length = fieldBuf[16];
      const decimals = fieldBuf[17];
      fields.push({ name, type, length, decimals });
      offset += 32;
    }

    return { fields, recordCount, headerSize, recordSize };
  } finally {
    fs.closeSync(fd);
  }
}

function parseValue(raw: string, field: DbfField): DbfValue {
  const trimmed = raw.trim();
  switch (field.type) {
    case "C":
    case "M":
      return raw.replace(/\0+$/, "").trimEnd();
    case "N":
    case "F":
    case "I":
    case "B":
    case "Y":
      return trimmed === "" ? null : Number(trimmed);
    case "L":
      return /[ynt]/i.test(trimmed) ? true : /[fn]/i.test(trimmed) ? false : null;
    case "D": {
      if (trimmed === "" || trimmed === "0" || /^0+$/.test(trimmed)) return null;
      const year = trimmed.slice(0, 4);
      const month = trimmed.slice(4, 6);
      const day = trimmed.slice(6, 8);
      return `${year}-${month}-${day}`;
    }
    case "T":
      return trimmed || null;
    default:
      return trimmed || null;
  }
}

/** Reads every non-deleted record. Deleted rows (leading 0x2A marker) are skipped — they were
 *  never meant to be visible to the running FoxPro app either. */
export function* readDbfRows(path: string): Generator<DbfRow> {
  const table = readDbfHeader(path);
  const fd = fs.openSync(path, "r");
  try {
    const recordBuf = Buffer.alloc(table.recordSize);
    for (let i = 0; i < table.recordCount; i++) {
      const offset = table.headerSize + i * table.recordSize;
      const bytesRead = fs.readSync(fd, recordBuf, 0, table.recordSize, offset);
      if (bytesRead < table.recordSize) break;
      if (recordBuf[0] === 0x2a) continue; // deleted

      const row: DbfRow = {};
      let fieldOffset = 1; // skip the deletion-flag byte
      for (const field of table.fields) {
        const raw = recordBuf.toString("latin1", fieldOffset, fieldOffset + field.length);
        row[field.name] = parseValue(raw, field);
        fieldOffset += field.length;
      }
      yield row;
    }
  } finally {
    fs.closeSync(fd);
  }
}
