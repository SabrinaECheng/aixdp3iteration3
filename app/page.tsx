import type { Metadata } from "next";
import Kiosk from "./kiosk/Kiosk";

export const metadata: Metadata = {
  title: "Playform — Interactive Booth Kiosk",
  description: "Playform: a touch-free booth kiosk that answers the general questions, hands visitors to sales staff and captures leads.",
};

export default function Home() {
  return <Kiosk />;
}
