import * as THREE from "three";

export type StylizedLitMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

const STYLIZED_SHADER_TAG = "vibejamStylizedShading";
const STYLIZED_SHADER_VERSION = "v3";

function shaderKeyPart(material: StylizedLitMaterial): string {
  if (typeof material.userData?.[STYLIZED_SHADER_TAG] === "string") {
    return material.userData[STYLIZED_SHADER_TAG] as string;
  }
  return STYLIZED_SHADER_VERSION;
}

export function isStylizedLitMaterial(material: THREE.Material): material is StylizedLitMaterial {
  return material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial;
}

export function applyStylizedShading<T extends StylizedLitMaterial>(material: T): T {
  const previousOnBeforeCompile = material.onBeforeCompile;
  const previousProgramCacheKey = material.customProgramCacheKey?.bind(material);
  material.userData[STYLIZED_SHADER_TAG] = STYLIZED_SHADER_VERSION;
  material.envMapIntensity = Math.min(material.envMapIntensity ?? 0.04, 0.04);

  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;",
      `
      vec3 vibejamDiffuse = totalDiffuse;
      float vibejamDiffuseLuma = max(max(vibejamDiffuse.r, vibejamDiffuse.g), vibejamDiffuse.b);
      float vibejamBand = vibejamDiffuseLuma < 0.2 ? 0.82 : (vibejamDiffuseLuma < 0.58 ? 0.94 : 1.04);
      vec3 vibejamBandedDiffuse = mix(vibejamDiffuse, vibejamDiffuse * vibejamBand, 0.55);
      float vibejamRim = pow(1.0 - saturate(dot(normalize(geometryNormal), normalize(geometryViewDir))), 2.6);
      vibejamRim *= 0.035;
      vec3 vibejamRimColor = mix(diffuseColor.rgb, vec3(1.0), 0.05);
      vec3 outgoingLight = vibejamBandedDiffuse + totalSpecular * 0.14 + totalEmissiveRadiance + vibejamRimColor * vibejamRim;
      `
    );
  };

  material.customProgramCacheKey = () => {
    const baseKey = previousProgramCacheKey ? previousProgramCacheKey() : material.type;
    return `${baseKey}:${shaderKeyPart(material)}`;
  };

  material.needsUpdate = true;
  return material;
}

export function stylizeObjectMaterials(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (Array.isArray(obj.material)) {
      for (const material of obj.material) {
        if (material && isStylizedLitMaterial(material)) applyStylizedShading(material);
      }
      return;
    }
    if (obj.material && isStylizedLitMaterial(obj.material)) {
      applyStylizedShading(obj.material);
    }
  });
}
