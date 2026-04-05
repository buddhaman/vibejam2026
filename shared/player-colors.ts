/**
 * Distinct packed RGB (0xRRGGBB) for up to 8 players without repeats.
 * With more than 8 clients, colors cycle by join order.
 */
export const PLAYER_COLOR_PALETTE: readonly number[] = [
  0xff2d2d, // vivid red
  0x2979ff, // vivid blue
  0xffdd00, // gold yellow
  0x00e676, // spring green
  0xd500f9, // magenta
  0x00e5ff, // electric cyan
  0xff6d00, // orange
  0xaa00ff, // violet
];

export function assignPlayerPaletteColor(existingColors: readonly number[]): number {
  const used = new Set(existingColors);
  for (const c of PLAYER_COLOR_PALETTE) {
    if (!used.has(c)) return c;
  }
  return PLAYER_COLOR_PALETTE[existingColors.length % PLAYER_COLOR_PALETTE.length]!;
}
