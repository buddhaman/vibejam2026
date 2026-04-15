import * as THREE from "three";
import { BuildingType, getBuildingRules, type BuildingType as BuildingTypeValue } from "../../shared/game-rules.js";
import { applyStylizedShading } from "./stylized-shading.js";

/** Materials we can player-tint in `BuildingEntity.render`. */
export type TintableMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

export type BuildingVariant = {
  root: THREE.Group;
  tintMaterials: TintableMaterial[];
  accentMaterials: TintableMaterial[];
};

export type BuildingSet = Record<BuildingTypeValue, BuildingVariant>;

function createMaterial(color: number, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  return applyStylizedShading(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
}

function createBox(
  size: { x: number; y: number; z: number },
  position: { x: number; y: number; z: number },
  material: THREE.MeshStandardMaterial
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.position.set(position.x, position.y, position.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createBarracksVariant(): BuildingVariant {
  const rules = getBuildingRules(BuildingType.BARRACKS);
  const footprintInset = 0.4;
  const bodyWidth = rules.footprintWidth - 1.2;
  const bodyDepth = rules.footprintDepth - 1.2;
  const wallHeight = rules.height - 2.3;
  const roofY = wallHeight + 0.82;
  const upperY = roofY + 0.83;
  const root = new THREE.Group();
  const tintMaterials = [
    createMaterial(0xb78f68, 0.92, 0.04),
    createMaterial(0x8b694d, 0.96, 0.02),
  ];
  const accentMaterials = [
    createMaterial(0x5c3f2e, 1, 0),
    createMaterial(0xd7c3a1, 0.72, 0.05),
  ];

  root.add(
    createBox(
      { x: rules.footprintWidth - footprintInset, y: 0.55, z: rules.footprintDepth - footprintInset },
      { x: 0, y: 0.275, z: 0 },
      accentMaterials[0]
    )
  );
  root.add(createBox({ x: bodyWidth, y: wallHeight, z: bodyDepth }, { x: 0, y: 0.55 + wallHeight * 0.5, z: 0 }, tintMaterials[0]));
  root.add(
    createBox(
      { x: rules.footprintWidth - 0.8, y: 0.45, z: rules.footprintDepth - 0.8 },
      { x: 0, y: roofY, z: 0 },
      accentMaterials[1]
    )
  );
  root.add(createBox({ x: bodyWidth - 2.6, y: 1.2, z: bodyDepth - 2.6 }, { x: 0, y: upperY, z: 0 }, tintMaterials[1]));
  root.add(createBox({ x: 2.2, y: 2.2, z: 1.1 }, { x: 0, y: 1.65, z: bodyDepth * 0.47 }, accentMaterials[1]));
  root.add(createBox({ x: 1.1, y: 2.7, z: 1.1 }, { x: -bodyWidth * 0.34, y: rules.height - 0.35, z: -bodyDepth * 0.34 }, accentMaterials[0]));
  root.add(createBox({ x: 1.1, y: 2.7, z: 1.1 }, { x: bodyWidth * 0.34, y: rules.height - 0.35, z: -bodyDepth * 0.34 }, accentMaterials[0]));

  return { root, tintMaterials, accentMaterials };
}

function createTowerVariant(): BuildingVariant {
  const rules = getBuildingRules(BuildingType.TOWER);
  const capY = rules.height - 3.75;
  const crownY = rules.height - 1.68;
  const root = new THREE.Group();
  const tintMaterials = [
    createMaterial(0xbab5a9, 0.96, 0.02),
    createMaterial(0x8c867c, 0.98, 0.01),
  ];
  const accentMaterials = [
    createMaterial(0x4e4339, 0.98, 0),
    createMaterial(0xd6c08c, 0.76, 0.06),
  ];

  root.add(
    createBox(
      { x: rules.footprintWidth + 0.5, y: 0.65, z: rules.footprintDepth + 0.5 },
      { x: 0, y: 0.325, z: 0 },
      accentMaterials[0]
    )
  );
  root.add(createBox({ x: rules.footprintWidth, y: rules.height - 4.7, z: rules.footprintDepth }, { x: 0, y: rules.height * 0.39, z: 0 }, tintMaterials[0]));
  root.add(
    createBox(
      { x: rules.footprintWidth + 0.7, y: 0.55, z: rules.footprintDepth + 0.7 },
      { x: 0, y: capY, z: 0 },
      accentMaterials[1]
    )
  );
  root.add(createBox({ x: rules.footprintWidth - 1.7, y: 3.6, z: rules.footprintDepth - 1.7 }, { x: 0, y: crownY, z: 0 }, tintMaterials[1]));
  root.add(createBox({ x: rules.footprintWidth - 3.4, y: 1.15, z: rules.footprintDepth - 3.4 }, { x: 0, y: rules.height + 0.7, z: 0 }, accentMaterials[0]));

  return { root, tintMaterials, accentMaterials };
}

function createTownCenterVariant(): BuildingVariant {
  const rules = getBuildingRules(BuildingType.TOWN_CENTER);
  const root = new THREE.Group();
  const tintMaterials = [
    createMaterial(0xc6ab7b, 0.9, 0.04),
    createMaterial(0x9d7850, 0.95, 0.02),
  ];
  const accentMaterials = [
    createMaterial(0x5f4530, 0.98, 0),
    createMaterial(0xdfcfaa, 0.72, 0.05),
  ];

  root.add(createBox({ x: rules.footprintWidth, y: 0.8, z: rules.footprintDepth }, { x: 0, y: 0.4, z: 0 }, accentMaterials[0]));
  root.add(createBox({ x: rules.footprintWidth - 1.4, y: 4.9, z: rules.footprintDepth - 1.4 }, { x: 0, y: 3.25, z: 0 }, tintMaterials[0]));
  root.add(createBox({ x: rules.footprintWidth - 0.8, y: 0.55, z: rules.footprintDepth - 0.8 }, { x: 0, y: 5.95, z: 0 }, accentMaterials[1]));
  root.add(createBox({ x: rules.footprintWidth - 4.2, y: 2.1, z: rules.footprintDepth - 4.2 }, { x: 0, y: 7.05, z: 0 }, tintMaterials[1]));
  root.add(createBox({ x: 2.4, y: 2.8, z: 1.3 }, { x: 0, y: 2.2, z: rules.footprintDepth * 0.42 }, accentMaterials[1]));
  root.add(createBox({ x: 1.3, y: 3.2, z: 1.3 }, { x: -rules.footprintWidth * 0.31, y: 8.1, z: -rules.footprintDepth * 0.31 }, accentMaterials[0]));
  root.add(createBox({ x: 1.3, y: 3.2, z: 1.3 }, { x: rules.footprintWidth * 0.31, y: 8.1, z: -rules.footprintDepth * 0.31 }, accentMaterials[0]));

  return { root, tintMaterials, accentMaterials };
}

function createArcheryRangeVariant(): BuildingVariant {
  const rules = getBuildingRules(BuildingType.ARCHERY_RANGE);
  const root = new THREE.Group();
  const tintMaterials = [
    createMaterial(0xcab487, 0.9, 0.04),
    createMaterial(0x976d4c, 0.94, 0.02),
  ];
  const accentMaterials = [
    createMaterial(0x4b3729, 0.99, 0),
    createMaterial(0xe2d4b4, 0.72, 0.05),
  ];

  root.add(createBox({ x: rules.footprintWidth, y: 0.65, z: rules.footprintDepth }, { x: 0, y: 0.325, z: 0 }, accentMaterials[0]));
  root.add(createBox({ x: rules.footprintWidth - 1.1, y: 3.6, z: rules.footprintDepth - 1.4 }, { x: 0, y: 2.45, z: 0 }, tintMaterials[0]));
  root.add(createBox({ x: rules.footprintWidth - 0.45, y: 0.36, z: rules.footprintDepth - 0.45 }, { x: 0, y: 4.45, z: 0 }, accentMaterials[1]));
  root.add(createBox({ x: rules.footprintWidth - 3.2, y: 1.65, z: rules.footprintDepth - 2.8 }, { x: 0, y: 5.45, z: 0 }, tintMaterials[1]));
  root.add(createBox({ x: 0.35, y: 2.9, z: rules.footprintDepth - 1.3 }, { x: -rules.footprintWidth * 0.23, y: 2.2, z: 0 }, accentMaterials[0]));
  root.add(createBox({ x: 0.35, y: 2.9, z: rules.footprintDepth - 1.3 }, { x: rules.footprintWidth * 0.23, y: 2.2, z: 0 }, accentMaterials[0]));
  root.add(createBox({ x: rules.footprintWidth - 1.5, y: 0.24, z: 0.24 }, { x: 0, y: 3.4, z: rules.footprintDepth * 0.32 }, accentMaterials[1]));

  return { root, tintMaterials, accentMaterials };
}

function createStableVariant(): BuildingVariant {
  const rules = getBuildingRules(BuildingType.STABLE);
  const root = new THREE.Group();
  const tintMaterials = [
    createMaterial(0xbba17b, 0.9, 0.04),
    createMaterial(0x855f43, 0.96, 0.02),
  ];
  const accentMaterials = [
    createMaterial(0x4d3626, 0.98, 0),
    createMaterial(0xd8c598, 0.74, 0.04),
  ];

  root.add(createBox({ x: rules.footprintWidth, y: 0.72, z: rules.footprintDepth }, { x: 0, y: 0.36, z: 0 }, accentMaterials[0]));
  root.add(createBox({ x: rules.footprintWidth - 1.2, y: 4.1, z: rules.footprintDepth - 1.2 }, { x: 0, y: 2.75, z: 0 }, tintMaterials[0]));
  root.add(createBox({ x: rules.footprintWidth - 0.8, y: 0.42, z: rules.footprintDepth - 0.8 }, { x: 0, y: 4.95, z: 0 }, accentMaterials[1]));
  root.add(createBox({ x: rules.footprintWidth - 2.4, y: 1.95, z: rules.footprintDepth - 2.4 }, { x: 0, y: 6.05, z: 0 }, tintMaterials[1]));
  root.add(createBox({ x: 2.2, y: 2.5, z: 1.2 }, { x: 0, y: 1.95, z: rules.footprintDepth * 0.42 }, accentMaterials[1]));
  root.add(createBox({ x: 1.05, y: 3.4, z: 1.05 }, { x: -rules.footprintWidth * 0.34, y: 6.55, z: -rules.footprintDepth * 0.28 }, accentMaterials[0]));
  root.add(createBox({ x: 1.05, y: 3.4, z: 1.05 }, { x: rules.footprintWidth * 0.34, y: 6.55, z: -rules.footprintDepth * 0.28 }, accentMaterials[0]));

  return { root, tintMaterials, accentMaterials };
}

export function createProceduralBuildingSet(): BuildingSet {
  return {
    [BuildingType.BARRACKS]: createBarracksVariant(),
    [BuildingType.TOWER]: createTowerVariant(),
    [BuildingType.TOWN_CENTER]: createTownCenterVariant(),
    [BuildingType.ARCHERY_RANGE]: createArcheryRangeVariant(),
    [BuildingType.STABLE]: createStableVariant(),
  };
}
