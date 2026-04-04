/**
 * Numeric building types — uint8 on the wire.
 * Keep in sync with server/src/constants.ts.
 */
export const BuildingType = {
  BARRACKS: 1,
  TOWER: 2,
} as const;

export type BuildingType = (typeof BuildingType)[keyof typeof BuildingType];
