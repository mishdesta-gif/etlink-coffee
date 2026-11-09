import type { Metadata } from "next";
import { AudiencePage } from "@/components/audience-page";
export const metadata: Metadata = { title: "Supply Ethiopian Coffee", description: "For Ethiopian farmers, cooperatives, traders, and licensed exporters offering coffee. Introduce your business to ET Link for manual review." };
export default function Suppliers() { return <AudiencePage buyer={false} />; }