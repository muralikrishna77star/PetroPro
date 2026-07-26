export interface PrintableSlipLine {
  itemName: string;
  qty: number;
  rate: number;
}

/** Opens a narrow, receipt-sized print dialog — used for anything that isn't (yet) a real tax
 *  invoice: an attendant's just-dispensed fuel, or a cashier-queue entry still awaiting payment.
 *  Uses the browser's native print dialog so it works with whatever printer is already set up
 *  on the device, including a WiFi-connected one — no printer-specific driver/protocol needed. */
export function printReferenceSlip(params: {
  tenantName: string;
  heading: string;
  vehicleNo?: string;
  lines: PrintableSlipLine[];
  time: string;
  footer: string;
}) {
  const w = window.open("", "_blank", "width=320,height=480");
  if (!w) return;
  const total = params.lines.reduce((sum, l) => sum + l.rate * l.qty, 0);
  const lineRows = params.lines
    .map(
      (l) => `<div class="row"><span>${l.itemName} × ${l.qty.toFixed(2)}</span><span>Rs ${(l.rate * l.qty).toFixed(2)}</span></div>`,
    )
    .join("");
  w.document.write(`<!doctype html><html><head><title>${params.heading}</title><style>
    body { font-family: ui-monospace, monospace; font-size: 12px; width: 260px; margin: 0 auto; padding: 12px; color: #000; }
    h1 { font-size: 14px; text-align: center; margin: 0 0 2px; }
    .sub { text-align: center; margin: 0 0 8px; }
    hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
    .row { display: flex; justify-content: space-between; margin: 2px 0; gap: 12px; }
    .center { text-align: center; }
    .total { font-weight: bold; }
  </style></head><body>
    <h1>${params.tenantName}</h1>
    <p class="sub">${params.heading}</p>
    <hr />
    ${params.vehicleNo ? `<div class="row"><span>Vehicle</span><span>${params.vehicleNo}</span></div>` : ""}
    ${lineRows}
    <hr />
    <div class="row total"><span>Total</span><span>Rs ${total.toFixed(2)}</span></div>
    <div class="row"><span>Time</span><span>${params.time}</span></div>
    <hr />
    <p class="center">${params.footer}</p>
  </body></html>`);
  w.document.close();
  w.focus();
  w.print();
}
