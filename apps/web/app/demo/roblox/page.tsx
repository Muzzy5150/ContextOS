import Link from "next/link";
import { loadRobloxPresentation } from "../../../../../scenarios/roblox-presentation";
import { RobloxPresentation } from "./presentation";
import "./presentation.css";

export const dynamic = "force-dynamic";
export default async function Page() {
  const initial = await loadRobloxPresentation();
  return <main className="presentation-desktop"><RobloxPresentation initial={initial} /><Link className="presentation-back" href="/">← CONTEXTOS DESKTOP</Link></main>;
}
