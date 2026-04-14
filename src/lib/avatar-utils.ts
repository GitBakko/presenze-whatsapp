/**
 * Shared avatar utilities for consistent employee avatars across the app.
 */

export const AVATAR_COLORS = [
  "from-blue-500 to-blue-600",
  "from-emerald-500 to-emerald-600",
  "from-violet-500 to-violet-600",
  "from-amber-500 to-amber-600",
  "from-rose-500 to-rose-600",
  "from-cyan-500 to-cyan-600",
  "from-indigo-500 to-indigo-600",
  "from-teal-500 to-teal-600",
];

export function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function getAvatarColor(name: string): string {
  return AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length];
}

/**
 * Returns a short display name, disambiguating homonyms.
 *
 * If the first name is unique among `allNames`, returns just the first name.
 * Otherwise returns "FirstName Surname" (full name).
 *
 * Example: ["Mattia Bianchi", "Mattia Rossi", "Luca Verdi"]
 *   getShortName("Mattia Bianchi", allNames) → "Mattia Bianchi"
 *   getShortName("Luca Verdi", allNames)     → "Luca"
 */
export function getShortName(fullName: string, allNames: string[]): string {
  const firstName = fullName.split(" ")[0];
  const sameFirst = allNames.filter((n) => n.split(" ")[0] === firstName);
  if (sameFirst.length > 1) return fullName;
  return firstName;
}
