import { notFound } from "next/navigation";
import HomePage, { type HeroVariant } from "../../HomePage";

/** The homepage with each candidate hero, for comparing them side by side:
 *  /preview/floor, /preview/walk, /preview/rooms, /preview/stage. Not for search engines. */
export const revalidate = 300;
export const metadata = { robots: { index: false, follow: false } };
const HEROES: HeroVariant[] = ["floor", "walk", "rooms", "stage", "classes"];

export default async function Preview({ params }: { params: Promise<{ hero: string }> }) {
  const { hero } = await params;
  if (!HEROES.includes(hero as HeroVariant)) notFound();
  return <HomePage hero={hero as HeroVariant} />;
}
