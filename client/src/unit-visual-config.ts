import { UnitType, type UnitType as UnitTypeValue } from "../../shared/game-rules.js";
import type { UnitModelSlot } from "./unit-instanced-models.js";

export type UnitVisualSpec = {
  modelSlot: UnitModelSlot;
  usesShield: boolean;
  usesMeleeWeapon: boolean;
  easyPick: boolean;
  containsEllipseMult: number;
  idleDetail: string;
  enemyDetailNoun: string;
  supportsSpreadControls: boolean;
  animationFamily: "agent" | "hoplite" | "archer" | "synthaur";
};

const UNIT_VISUAL_SPECS: Record<UnitTypeValue, UnitVisualSpec> = {
  [UnitType.VILLAGER]: {
    modelSlot: "agent",
    usesShield: false,
    usesMeleeWeapon: false,
    easyPick: true,
    containsEllipseMult: 1.7,
    idleDetail: "Can gather resources",
    enemyDetailNoun: "agents",
    supportsSpreadControls: false,
    animationFamily: "agent",
  },
  [UnitType.WARBAND]: {
    modelSlot: "hoplite",
    usesShield: true,
    usesMeleeWeapon: true,
    easyPick: false,
    containsEllipseMult: 1,
    idleDetail: "Heavy melee line",
    enemyDetailNoun: "units",
    supportsSpreadControls: true,
    animationFamily: "hoplite",
  },
  [UnitType.ARCHER]: {
    modelSlot: "agent",
    usesShield: false,
    usesMeleeWeapon: false,
    easyPick: true,
    containsEllipseMult: 1.18,
    idleDetail: "Ranged skirmisher line",
    enemyDetailNoun: "archers",
    supportsSpreadControls: true,
    animationFamily: "archer",
  },
  [UnitType.SYNTHAUR]: {
    modelSlot: "synthaur",
    usesShield: false,
    usesMeleeWeapon: false,
    easyPick: false,
    containsEllipseMult: 1.08,
    idleDetail: "Fast shock cavalry",
    enemyDetailNoun: "synthaurs",
    supportsSpreadControls: true,
    animationFamily: "synthaur",
  },
};

export function getUnitVisualSpec(unitType: UnitTypeValue): UnitVisualSpec {
  return UNIT_VISUAL_SPECS[unitType] ?? UNIT_VISUAL_SPECS[UnitType.WARBAND];
}
