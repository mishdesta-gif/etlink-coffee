import type { Metadata } from "next";
import { AudiencePage } from "@/components/audience-page";
export const metadata: Metadata = { title: "Buy Ethiopian Coffee", description: "For international importers, domestic buyers, and Ethiopian exporters purchasing coffee. Discuss your requirements privately with ET Link." };
export default function Buyers() { return <AudiencePage buyer />; }