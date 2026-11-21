// The public website (/) and Product Tour (/tour). Screenshots come from Green Valley Fuels, a
// fictional demo station made by `npm run seed:demo --workspace apps/api` into its own database, and
// live in public/assets/tour so visitors who aren't signed in can load them. Never put a real
// station's data here: no real names, vehicles, GSTINs or figures.
//
// Keep every claim true of the shipped product. This is what prospective dealers read.

export const SALES_CONTACT = {
  email: "makfreelancer77@gmail.com",
  phone: "+91 77080 80484",
  phoneHref: "tel:+917708080484",
};

export const SITE_URL = "https://petropro.online";

export type Screen = { src: string; alt: string; width: number; height: number; cropTop?: number };

export type TourSlide =
  | { kind: "cover"; eyebrow: string; title: string; subtitle: string; image: Screen }
  | { kind: "points"; eyebrow: string; title: string; intro?: string; points: { title: string; text: string }[] }
  | { kind: "flow"; eyebrow: string; title: string; intro: string; steps: { title: string; text: string }[]; footnote: string }
  | { kind: "feature"; eyebrow: string; title: string; intro: string; bullets: string[]; image: Screen }
  | { kind: "contact"; eyebrow: string; title: string; intro: string; offers: string[] };

/** A desktop screen, 1440 × 900, optionally showing only its top part (0 to 1 of its height). */
const shot = (name: string, alt: string, cropTop?: number): Screen => ({ src: `/assets/tour/${name}.jpg`, alt, width: 1440, height: 900, cropTop });
/** A phone screen, 390 × 844. */
const phone = (name: string, alt: string): Screen => ({ src: `/assets/tour/${name}.jpg`, alt, width: 390, height: 844 });

export const TOUR_SLIDES: TourSlide[] = [
  {
    kind: "cover",
    eyebrow: "PetroPro Product Tour",
    title: "Run your fuel station from forecourt to final report",
    subtitle:
      "Attendant entry, billing, credit customers, thermal receipts, stock, GST and shifts for petrol bunks, in one system that works on the counter PC and the attendant's phone.",
    image: shot("dashboard", "PetroPro Station Control Center showing today's sales, bills, pending queue and customer dues"),
  },
  {
    kind: "points",
    eyebrow: "The challenge",
    title: "A busy forecourt outgrows the old billing PC",
    intro: "Most bunks still bill on DOS-era software and a notebook. Every day brings the same problems:",
    points: [
      { title: "Attendants and cashier out of step", text: "Fills are shouted across the forecourt or written on slips, and some never reach a bill." },
      { title: "Credit customers chasing statements", text: "Fleet owners want vehicle-wise bills and mileage. Preparing them by hand takes hours every month." },
      { title: "Stock that doesn't tally", text: "Tanker receipts, daily sales and the dip don't agree, and there's no day-book to show why." },
      { title: "Cash that goes missing between shifts", text: "Nobody can say which shift was short, or who changed a bill after it was printed." },
    ],
  },
  {
    kind: "flow",
    eyebrow: "How PetroPro works",
    title: "One entry, from the pump to the books",
    intro: "Every fill is entered once. Billing, stock, customer dues and reports all read from it.",
    steps: [
      { title: "Attendant", text: "Enters the vehicle, pump, fuel, litres and odometer on a phone at the pump." },
      { title: "Cashier", text: "Sees it instantly in the pending queue, adds oil or DEF if needed, and settles the bill." },
      { title: "Receipt", text: "Prints silently on the counter's thermal printer, with your oil company's logo." },
      { title: "Books", text: "Stock, the customer's dues, the shift's cash and every report update on their own." },
    ],
    footnote: "Cancel or reprint a bill and everything follows, with a record of who did it and when.",
  },
  {
    kind: "feature",
    eyebrow: "Attendant app",
    title: "Fills entered at the pump, not remembered later",
    intro: "Attendants use PetroPro on any Android phone. No app store, no training: it opens like a website and installs to the home screen.",
    bullets: [
      "Vehicle, pump, fuel, litres or amount, and odometer",
      "Send to the cashier, or settle on the spot",
      "Keeps working through a network drop, and sends when it's back",
      "Each attendant signs in with their own account",
    ],
    image: phone("attendant", "Attendant Entry screen on a phone with vehicle number, pump, fuel, litres and odometer filled in"),
  },
  {
    kind: "feature",
    eyebrow: "Cashier queue",
    title: "The cashier sees every fill the moment it's entered",
    intro: "No slips, no shouting. Each attendant entry waits in the queue until it becomes exactly one bill.",
    bullets: [
      "Vehicle, fuel, litres or amount, and odometer, ready to bill",
      "Add lubricants or DEF before settling",
      "Cash, credit, card or UPI, with your UPI QR on screen",
      "An entry can't be billed twice",
    ],
    image: shot("cashier", "Cashier pending queue listing attendant entries by vehicle, fuel, litres and odometer", 0.62),
  },
  {
    kind: "feature",
    eyebrow: "Billing",
    title: "Fast counter billing for walk-in and credit sales",
    intro: "A bill takes seconds: pick the sale type, the vehicle and the items. Rates come from your price list.",
    bullets: [
      "Cash, credit, card and UPI bills, each with its own heading",
      "Credit bills check the customer's limit before saving",
      "Look up, reprint or cancel any bill",
      "Close the day to lock that date's stock and sales",
    ],
    image: shot("billing", "Billing screen with a cash bill for diesel and engine oil and a grand total"),
  },
  {
    kind: "feature",
    eyebrow: "Thermal receipts",
    title: "Receipts with your oil company's logo, printed silently",
    intro: "PetroPro prints to 58 mm and 80 mm thermal printers on USB, network or Bluetooth, straight from the bill, with no print dialog.",
    bullets: [
      "Indian Oil, HP or Bharat Petroleum logo, in your choice of size",
      "Reprints are marked DUPLICATE BILL and recorded",
      "QR code on the receipt opens the bill online",
      "Send the invoice on WhatsApp instead of paper",
    ],
    image: shot("printer-settings", "Printer Settings with Indian Oil chosen as the oil company and its logo preview"),
  },
  {
    kind: "feature",
    eyebrow: "Credit and fleet customers",
    title: "Every credit customer's dues, limit and payments in one place",
    intro: "Fleet owners, transporters, schools and factories buy on credit. PetroPro keeps their accounts straight.",
    bullets: [
      "Credit limit, opening balance and running dues",
      "Record payments by cash, cheque or bank transfer",
      "Vehicles linked to their owner, with fleet cards",
      "Give each customer their own portal login",
    ],
    image: shot("customers", "Customer details for a fleet customer showing dues, credit limit, receipts and portal login"),
  },
  {
    kind: "feature",
    eyebrow: "Statements",
    title: "Month-end statements in a click, not an afternoon",
    intro: "Bill-by-bill credit statements for any customer and period, laid out the way your customers already know.",
    bullets: [
      "Vehicle-wise grouping and order numbers",
      "Opening and closing balances",
      "Print it, or save it as a PDF to send",
      "The same statement your customers see in their portal",
    ],
    image: shot("report-statement", "Credit customer statement listing each bill with date, vehicle, quantity, rate and amount"),
  },
  {
    kind: "feature",
    eyebrow: "Vehicle mileage",
    title: "Tell fleet owners how far each litre went",
    intro: "Odometer readings taken at the pump turn into kilometres per litre for every vehicle and every fill.",
    bullets: [
      "Previous and current reading, kilometres and mileage",
      "Search one vehicle or all vehicles matching a number",
      "Spot a vehicle whose mileage suddenly drops",
      "A reason for fleets to buy from you, not the next bunk",
    ],
    image: shot("report-mileage", "Vehicle Mileage report with previous km, current reading, mileage, litres and amount per fill"),
  },
  {
    kind: "feature",
    eyebrow: "GST and reports",
    title: "Sales and tax reports your accountant can file from",
    intro: "Item-wise, cashier-wise, group-wise and HSN-wise sales, and GST summaries, by day, month, quarter or year.",
    bullets: [
      "GST summary split by tax rate, with taxable value and tax",
      "Bill register, vehicle-wise and fleet card sales",
      "Download to Excel or PDF",
      "Fuel and lubricant taxes kept apart",
    ],
    image: shot("report-gst", "GST Summary report by day and tax rate with taxable value, tax amount and total"),
  },
  {
    kind: "feature",
    eyebrow: "Stock",
    title: "A stock day-book that tallies every day",
    intro: "Opening, receipts, sales and closing for every product, every day. Tanker receipts add to stock the moment they're recorded.",
    bullets: [
      "Purchases with invoice numbers and tax",
      "Price revisions scheduled ahead, applied in one click on the day",
      "Daily stock closed with the day's sales",
      "Group-wise stock and purchase reports",
    ],
    image: shot("report-stock", "Stock Day-book report with opening, receipts, sales, closing and balance per product per day"),
  },
  {
    kind: "feature",
    eyebrow: "Customer portal",
    title: "Your fleet customers check their own accounts",
    intro: "Each credit customer can sign in to see their purchases, payments and vehicles, with no phone calls to your office.",
    bullets: [
      "Purchase history, account ledger and credit statement",
      "Vehicle-wise mileage for their own fleet",
      "Download as CSV or PDF",
      "Sign in with email and password, or Google",
    ],
    image: shot("portal", "Customer portal showing a fleet customer's purchases, payments and closing balance for the month"),
  },
  {
    kind: "points",
    eyebrow: "Control",
    title: "Know who did what, and that the cash adds up",
    points: [
      { title: "Shifts", text: "Each cashier opens and closes a shift. PetroPro works out the expected cash and shows any shortfall." },
      { title: "Roles", text: "Admin, owner, cashier and attendant accounts each see only their own screens." },
      { title: "Audit log", text: "Sign-ins, reprints, cancellations and setting changes are all recorded." },
      { title: "Backups", text: "An automatic daily backup, and a one-click download and restore." },
      { title: "Live dashboard", text: "Today's sales, the pending queue, dues and low stock, with a big-screen mode for the office." },
      { title: "Coming from FoxPro?", text: "PetroPro imports the data from DOS-era billing software, so you don't start from scratch." },
    ],
  },
  {
    kind: "contact",
    eyebrow: "Get started",
    title: "See PetroPro working on your station's data",
    intro: "We'll show you the whole flow, from the attendant's phone to the GST report, and answer your questions.",
    offers: [
      "A live demo, in person or online",
      "Help moving your customers, vehicles and items across",
      "Set-up of your thermal printer and attendant phones",
      "Training for your cashiers and attendants",
    ],
  },
];

/** Feature cards for the home page. */
export const FEATURES: { title: string; text: string }[] = [
  { title: "Attendant app", text: "Fills entered on a phone at the pump, sent straight to the cashier." },
  { title: "Counter billing", text: "Cash, credit, card and UPI bills in seconds, from your price list." },
  { title: "Thermal receipts", text: "Silent printing with your Indian Oil, HP or Bharat Petroleum logo." },
  { title: "Credit customers", text: "Limits, dues, payments, statements and a portal for each customer." },
  { title: "Vehicle mileage", text: "Kilometres per litre for every fleet vehicle, from pump odometer readings." },
  { title: "GST reports", text: "Item, HSN and tax-rate summaries, by day, month or year, to Excel or PDF." },
  { title: "Stock day-book", text: "Opening, receipts, sales and closing for every product, every day." },
  { title: "Shifts and audit", text: "Cash checked per shift, and a record of every sensitive action." },
  { title: "Works offline", text: "Keeps billing through a network drop and catches up when it's back." },
];
