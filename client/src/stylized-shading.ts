import * as THREE from "three";

export type StylizedLitMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

const STYLIZED_SHADER_TAG = "agiOfMythologyStylizedShading";
const STYLIZED_SHADER_VERSION = "v4";

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
      vec3 agiomDiffuse = totalDiffuse;
      float agiomDiffuseLuma = max(max(agiomDiffuse.r, agiomDiffuse.g), agiomDiffuse.b);
      float agiomBand = agiomDiffuseLuma < 0.2 ? 0.82 : (agiomDiffuseLuma < 0.58 ? 0.94 : 1.04);
      vec3 agiomBandedDiffuse = mix(agiomDiffuse, agiomDiffuse * agiomBand, 0.55);
      float agiomRim = pow(1.0 - saturate(dot(normalize(geometryNormal), normalize(geometryViewDir))), 2.6);
      agiomRim *= 0.035;
      vec3 agiomRimColor = mix(diffuseColor.rgb, vec3(1.0), 0.05);
      vec3 outgoingLight = agiomBandedDiffuse + totalSpecular * 0.14 + totalEmissiveRadiance + agiomRimColor * agiomRim;
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
