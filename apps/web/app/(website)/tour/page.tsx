import type { Metadata } from "next";
import { SALES_CONTACT, TOUR_SLIDES } from "@/lib/marketing/productTour";
import TourDeck from "./TourDeck";

export const metadata: Metadata = {
  title: "Product Tour: PetroPro",
  description:
    "A guided tour of PetroPro: attendant app, cashier queue, billing, thermal receipts, credit statements, vehicle mileage, stock, GST and the customer portal.",
};

export default function ProductTourPage() {
  return <TourDeck slides={TOUR_SLIDES} contact={SALES_CONTACT} />;
}
