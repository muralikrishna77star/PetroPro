"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { PrintPayload } from "@petropro/shared-types";

/** Shows a receipt as it will come out: same characters per line, on white paper in either theme. */
export function ReceiptPreview({ payload }: { payload: PrintPayload }) {
  const { document: doc, logo_preview: logo } = payload;
  const [qrImages, setQrImages] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    const wanted = doc.blocks.flatMap((b) => (b.kind === "qr" ? [b.data] : []));
    Promise.all(wanted.map(async (data) => [data, await QRCode.toDataURL(data, { margin: 1, width: 200 })] as const)).then((pairs) => {
      if (live) setQrImages(Object.fromEntries(pairs));
    });
    return () => {
      live = false;
    };
  }, [doc]);

  return (
    <div className="max-w-full overflow-x-auto rounded bg-white p-3 text-black" data-testid="receipt-preview">
      <div style={{ width: `${doc.width}ch`, fontFamily: '"Courier New", Courier, monospace', fontSize: 13, lineHeight: 1.25 }}>
        {doc.blocks.map((block, i) => {
          if (block.kind === "rule") return <div key={i}>{"-".repeat(doc.width)}</div>;
          if (block.kind === "logo") {
            // eslint-disable-next-line @next/next/no-img-element -- a stored data: URL, not an optimizable remote image
            return logo ? <img key={i} src={logo} alt="Logo" className="mx-auto mb-1 w-40" /> : null;
          }
          if (block.kind === "qr") {
            // eslint-disable-next-line @next/next/no-img-element -- generated on this device
            return qrImages[block.data] ? <img key={i} src={qrImages[block.data]} alt="QR code" className="mx-auto mt-1 w-28" /> : null;
          }
          return (
            <div
              key={i}
              style={{
                whiteSpace: "pre",
                textAlign: block.align,
                fontWeight: block.bold ? 700 : 400,
                fontSize: block.double ? 26 : undefined,
              }}
            >
              {block.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
