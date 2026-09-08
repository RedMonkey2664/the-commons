/**
 * Cafe drinks — 03_WORLD_MAP_ZONES.md, Phase 6.
 *
 * 03 asks for exactly this and is unusually specific about its limits:
 *
 *   "Order a drink: cosmetic-only interaction — picks a drink icon that shows
 *    over your avatar for flavor, no gameplay effect. Cheap to build, good
 *    'third place' texture."
 *
 * So: no cost, no currency, no unlock, no stat. A drink is a thing you are
 * holding, visible to everyone in the room, and that is the whole feature. It
 * earns its place because a third place is made of small optional gestures —
 * the point is that you *chose* something and other people can see it.
 *
 * Unlike cosmetics (shared/cosmetics.ts) a drink is NOT stored per user as a
 * preference to be restored. It is a thing you ordered, in a room, now — it
 * lives in room state and goes away when you do, which is also what happens to
 * a real cup of coffee.
 */

export interface Drink {
  id: string;
  displayName: string;
  /** The liquid colour, used for both the icon and the order confirmation. */
  color: string;
  /** Drawn with a pale head — cappuccino foam, cocoa marshmallow. */
  foam: boolean;
  /** Barista's line when you order it. Flavour, in both senses. */
  line: string;
}

export const DRINKS: Drink[] = [
  {
    id: 'espresso',
    displayName: 'Espresso',
    color: '#4A2C1A',
    foam: false,
    line: 'Espresso. No notes, no ceremony.',
  },
  {
    id: 'latte',
    displayName: 'Latte',
    color: '#C8A47C',
    foam: true,
    line: 'One latte. I attempted a leaf. It is a blob.',
  },
  {
    id: 'tea',
    displayName: 'Tea',
    color: '#C4772E',
    foam: false,
    line: 'Tea, in the big cup. Steeping is your problem now.',
  },
  {
    id: 'matcha',
    displayName: 'Matcha',
    color: '#7FA85C',
    foam: true,
    line: 'Matcha. Whisked properly, since you did not ask.',
  },
  {
    id: 'cocoa',
    displayName: 'Cocoa',
    color: '#6B4230',
    foam: true,
    line: 'Cocoa, extra marshmallow. It is that kind of afternoon.',
  },
  {
    id: 'juice',
    displayName: 'Juice',
    color: '#E8913C',
    foam: false,
    line: 'Orange juice. Genuinely the correct order sometimes.',
  },
];

export function getDrink(id: string): Drink | undefined {
  return DRINKS.find((d) => d.id === id);
}

/** True for a drink id the server should accept, or '' meaning "put it down". */
export function isValidDrinkId(id: unknown): id is string {
  return id === '' || (typeof id === 'string' && DRINKS.some((d) => d.id === id));
}
