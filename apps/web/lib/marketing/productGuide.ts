// The Product Tour Guide (/guide): how station staff use PetroPro, screen by screen. Unlike the
// sales tour (/tour), this is written for the people who already have an account: what to press,
// in what order, and who can see each screen. It's public, so it can be opened from the login page
// before signing in.
//
// Keep every step true of the shipped screens. Button and field names here are the ones on screen;
// if a screen's wording changes, change it here too. Screenshots are the demo station's
// (public/assets/tour), never a real station's data.

import type { Screen } from "./productTour";

export type RoleKey = "super_admin" | "owner" | "operator" | "field_operator";

export const GUIDE_ROLES: { key: RoleKey; name: string; also: string; starts: string; sees: string }[] = [
  {
    key: "field_operator",
    name: "Field Operator",
    also: "Pump attendant",
    starts: "Attendant",
    sees: "Attendant entry and their own shift, on a phone at the pump.",
  },
  {
    key: "operator",
    name: "Operator",
    also: "Cashier",
    starts: "Cashier Queue",
    sees: "Cashier Queue, Billing, Customers and their own shift. A “Billing screen only” account sees just Billing.",
  },
  {
    key: "owner",
    name: "Owner",
    also: "Station owner or manager",
    starts: "Cashier Queue",
    sees: "Everything an Operator sees, plus Dashboard, Reports, Catalog, Purchases, Rate Changes, Settings, Printer Settings and Audit Logs.",
  },
  {
    key: "super_admin",
    name: "Super Admin",
    also: "Administrator",
    starts: "Cashier Queue",
    sees: "Every screen, including Users, Backup & Restore and Legacy Import.",
  },
];

export const ROLE_NAMES: Record<RoleKey, string> = {
  super_admin: "Super Admin",
  owner: "Owner",
  operator: "Operator",
  field_operator: "Field Operator",
};

/** A day at the station, in the order things happen. */
export const DAY_FLOW: { title: string; text: string; chapter: string }[] = [
  { title: "Open shift", text: "Each person opens a shift with the cash in hand.", chapter: "shifts" },
  { title: "Fill at the pump", text: "The attendant enters the vehicle, fuel and litres.", chapter: "attendant" },
  { title: "Settle the bill", text: "The cashier picks it from the queue and prints the bill.", chapter: "cashier" },
  { title: "Close shift", text: "Count the cash. PetroPro shows any shortfall.", chapter: "shifts" },
  { title: "Close Day", text: "Utilities → Close Day. Shows the day's sales, then moves billing on to the next date.", chapter: "billing" },
];

export type GuideChapter = {
  id: string;
  /** Short name for the contents list. */
  nav: string;
  title: string;
  roles: RoleKey[];
  /** Where to find it in the menu. */
  where: string;
  intro: string;
  steps: string[];
  tips?: string[];
  image: Screen;
};

const shot = (name: string, alt: string): Screen => ({ src: `/assets/tour/${name}.jpg`, alt, width: 1440, height: 900 });
const phone = (name: string, alt: string): Screen => ({ src: `/assets/tour/${name}.jpg`, alt, width: 390, height: 844 });

export const GUIDE_CHAPTERS: GuideChapter[] = [
  {
    id: "attendant",
    nav: "Attendant entry",
    title: "Enter a fill at the pump",
    roles: ["field_operator", "owner", "super_admin"],
    where: "Bill › Attendant (opens by itself when an attendant signs in)",
    intro: "The attendant records each fill on a phone while standing at the pump. It reaches the cashier the moment it's sent.",
    steps: [
      "Type the Vehicle number, for example KA01AB1234.",
      "Choose the Pump, if your station tracks pumps.",
      "Search for the Fuel / item and enter the Quantity (litres).",
      "Enter the Odometer reading if the customer wants mileage on their statement.",
      "Leave Send to cashier selected and press Send to cashier. The cashier sees it straight away.",
      "To take payment yourself, choose Settle now, pick Cash, UPI or Card, and press Settle & print.",
    ],
    tips: [
      "No signal? The entry is saved on the phone and sent by itself when the network is back. Press “queued — sync now” to send it sooner.",
      "For UPI, show the customer the station's QR code and tick that the money has arrived before settling.",
    ],
    image: phone("attendant", "Attendant entry screen on a phone, with vehicle number, pump, fuel and litres"),
  },
  {
    id: "cashier",
    nav: "Cashier Queue",
    title: "Settle a fill from the Cashier Queue",
    roles: ["operator", "owner", "super_admin"],
    where: "Bill › Cashier Queue",
    intro: "Every fill sent by an attendant waits here, showing the vehicle, item, litres and odometer.",
    steps: [
      "Click a fill in the list to open it.",
      "Add lubricants or accessories the customer is buying with it, if any: pick the item, enter the Qty and add it.",
      "Choose the Payment type: Cash, UPI, Card or Credit.",
      "Press Accept payment & print bill. The bill prints, and its number and totals appear below.",
    ],
    tips: [
      "Print next to a fill prints a reference slip only. It is not a tax invoice, because the fill hasn't been paid yet.",
      "For UPI, the station's QR code is shown on screen. Tick that the payment was received to enable the button.",
    ],
    image: shot("cashier", "Cashier Queue with pending fills from attendants"),
  },
  {
    id: "billing",
    nav: "Billing",
    title: "Make a bill at the counter",
    roles: ["operator", "owner", "super_admin"],
    where: "Bill › Billing",
    intro: "Billing is for walk-in and credit sales made at the counter. The billing date is shown at the top.",
    steps: [
      "Pick the Sale Type: Cash, Credit, Card or UPI. A Credit bill needs the customer code.",
      "Enter the Vehicle no. first. For a customer's vehicle, the Customer code fills itself in on a Credit sale. A new number is added to the Vehicles list, and a near miss shows “Did you mean”.",
      "Fill in Pump Details if you need it on the bill.",
      "For a Credit customer with a purchase order, pick it under Purchase Orders and press Bill this order. Its items come onto the bill.",
      "Add each item by its code or name. Enter the Qty, or enter the Amount and PetroPro works out the quantity from the rate.",
      "Press Save, or Save and Print to print the bill straight away.",
      "At the end of the day, open Utilities → Close Day and press Close Day. It shows the day's sales and your own sales, item by item. Press Close Day again to confirm, and it shows the next billing date.",
    ],
    tips: [
      "Save as draft sets a bill aside so you can serve the next customer. Resume it later from the Draft queue.",
      "Full screen hides the menu so Billing fills a tablet or small screen.",
      "Look up / cancel a bill finds any bill by number to reprint it. Only an Owner or Super Admin can cancel one.",
      "For fuel that tracks mileage, Mileage Check appears. Tick “Record mileage for this fill” and enter the opening and closing km. One mileage entry is allowed per sale.",
      "Close Day is not on the Billing screen, and “Billing screen only” accounts can't reach it, so a tablet can't close the day for the whole station. An Owner can set the earliest time the day can be closed, and whether bills after closing go to tomorrow straight away.",
    ],
    image: shot("billing", "Billing screen with sale type, vehicle, item lines and totals"),
  },
  {
    id: "shifts",
    nav: "Shifts",
    title: "Open and close your shift",
    roles: ["field_operator", "operator", "owner", "super_admin"],
    where: "Shifts",
    intro: "A shift keeps track of the cash each person handled, so a shortfall can be traced to a shift.",
    steps: [
      "At the start of your shift, enter the Opening cash in hand and press Open shift.",
      "At the end, count the cash and enter it as Closing cash (counted). Add notes if needed.",
      "Press Close shift. PetroPro shows the Expected cash, the Actual cash and the Variance.",
    ],
    tips: ["Owners and Super Admins also see All shifts, with each person's opening, closing and variance."],
    image: shot("shifts", "Shifts screen with opening cash, closing cash and variance"),
  },
  {
    id: "customers",
    nav: "Customers & receipts",
    title: "Manage credit customers and their payments",
    roles: ["operator", "owner", "super_admin"],
    where: "Maintenance › Customers",
    intro: "Each credit customer has a credit limit, current dues and a ledger of bills and payments.",
    steps: [
      "To add a customer, enter the Name, Credit limit and WhatsApp / mobile number, then press Add.",
      "Click a customer to see their details and ledger.",
      "When they pay, use Record a receipt. Their dues go down at once.",
      "Use Set opening balance for dues carried over from before PetroPro.",
      "To give them access to the customer portal, save their email under Customer Login and press Set/reset password. Pass the temporary password on to them.",
    ],
    tips: [
      "The WhatsApp number is used by Send Invoice to send credit bills to the customer.",
      "Maintenance › Vehicles lists every vehicle and the customer it belongs to. Use Change customer to move one, and Find near matches to merge numbers keyed in different ways. Merging corrects the old bills too.",
    ],
    image: shot("customers", "Customers screen with dues, credit limit and ledger"),
  },
  {
    id: "stock",
    nav: "Purchases & rates",
    title: "Record tanker loads and change prices",
    roles: ["owner", "super_admin"],
    where: "Maintenance › Purchases, and Search › Rate Changes",
    intro: "Purchases add stock. Rate changes set new prices from a date you choose.",
    steps: [
      "When a tanker or stock delivery arrives, open Purchases. Pick the item and enter the Quantity, the Total value (₹) and the invoice number. Press Record purchase.",
      "For a new price, open Rate Changes. Pick the item, enter the New retail rate (₹) and the date it takes effect, and press Schedule change.",
      "On that date, press Apply due changes. Billing uses the new rate from then on.",
      "To add or change products, use Maintenance › Catalog.",
    ],
    tips: ["The Stock Day-book report shows each product's opening, receipts, sales and closing for every day."],
    image: shot("purchases", "Record a Purchase screen"),
  },
  {
    id: "reports",
    nav: "Reports",
    title: "Run sales, GST and stock reports",
    roles: ["owner", "super_admin"],
    where: "Reports",
    intro: "Every report reads from the same bills, so the figures always agree with each other.",
    steps: [
      "Choose a report: sales (item-wise, cashier-wise, group-wise, HSN-wise), Bill Register, vehicle-wise or fleet card sales, GST Summary, stock, purchases, Vehicle Mileage or Customer Statement (Credit).",
      "Choose the date range and, where offered, Day, Weekly, Monthly, Quarterly, Half Yearly or Yearly.",
      "Press Run report.",
      "For the GST Summary, press Download Excel to send to your accountant, or Print / PDF.",
    ],
    image: shot("report-gst", "GST Summary report by tax rate"),
  },
  {
    id: "dashboard",
    nav: "Dashboard",
    title: "Watch the station on the Dashboard",
    roles: ["owner", "super_admin"],
    where: "Dashboard",
    intro: "Today's sales and bills, fills waiting in the queue, top customer dues, low stock and recent activity, on one screen.",
    steps: [
      "Open Dashboard from the menu.",
      "Look at the sales trend to compare today with recent days.",
      "Press Big screen to show it on an office TV. Press Exit big screen to go back.",
    ],
    image: shot("dashboard", "Dashboard with today's sales, pending queue and customer dues"),
  },
  {
    id: "printing",
    nav: "Receipt printing",
    title: "Set up the thermal printer",
    roles: ["owner", "super_admin"],
    where: "Utilities › Printer Settings",
    intro: "Printer settings are kept for each computer, so the counter PC and an office PC can print differently.",
    steps: [
      "On the counter computer, open Printer Settings and choose the Printer model and the Printer on this computer.",
      "Turn Print logo and Print QR code on or off, and press Save.",
      "To print bills made on tablets and phones at the counter, turn on “Print station: also print bills sent from tablets and phones” on the counter computer.",
      "Under Receipt content, set what every receipt shows, then press Save.",
    ],
    tips: ["The print station prints only while PetroPro is open on that computer."],
    image: shot("printer-settings", "Printer Settings for this terminal and receipt content"),
  },
  {
    id: "admin",
    nav: "Users & settings",
    title: "Add staff and set up the station",
    roles: ["owner", "super_admin"],
    where: "Utilities › Users, Settings and Audit Logs",
    intro: "Accounts, the company profile, tax and backups. Users and Backup & Restore are for the Super Admin.",
    steps: [
      "In Users, add each person with their role. For a tablet or phone cashier, tick Billing screen only.",
      "In Settings, fill in the Company Profile. It appears on every printed invoice. Add your Payment QR Code for UPI.",
      "Add your Pumps, and switch the Financial Year when a new year starts.",
      "Under Backup & Restore, download a backup or restore one. Automatic daily backups keep the last 14.",
      "Audit Logs shows who signed in, reprinted, cancelled or changed a setting, and when.",
    ],
    image: shot("users", "Users screen with roles"),
  },
  {
    id: "portal",
    nav: "Customer portal",
    title: "What your credit customers see",
    roles: [],
    where: "Customer login, linked from the staff login page",
    intro: "Credit customers can check their own account without calling the station.",
    steps: [
      "The customer opens Customer login and signs in with the email and password you set for them, or with Google.",
      "They see their purchases, payments, ledger and credit statement.",
      "Fleet customers also see mileage for each of their vehicles.",
      "Under Purchase orders they order fuel and other items for one of their vehicles. They can allow the station to add other essential items at billing.",
      "Everything can be downloaded as CSV or PDF.",
    ],
    image: shot("portal", "Customer portal with purchases, payments and closing balance"),
  },
];
