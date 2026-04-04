/**
 * Numeric building types — uint8 on the wire.
 * Keep in sync with client/src/constants.ts.
 */
export const BuildingType = {
  BARRACKS: 1,
  TOWER: 2,
} as const;

export type BuildingType = (typeof BuildingType)[keyof typeof BuildingType];

export const VALID_BUILDING_TYPES = new Set<number>(Object.values(BuildingType));
