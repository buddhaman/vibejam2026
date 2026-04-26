import * as THREE from "three";
import { GAME_RULES, getBuildingRules, type BuildingType as BuildingTypeValue } from "../../shared/game-rules.js";
import type { Game } from "./game.js";

const FOW_TEXTURE_SIZE = 512;
const FOW_PLANE_MARGIN = 220;
const FOW_PLANE_Y = 18;
const FOW_FOG_COLOR = new THREE.Color(0xb1bfcb);
const FOW_FOG_COLOR_DEEP = new THREE.Color(0x8399ae);

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusPx: number,
  alpha = 1
) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radiusPx);
  gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
  gradient.addColorStop(0.72, `rgba(255,255,255,${alpha * 0.92})`);
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
  ctx.fill();
}

function worldToTextureCoord(value: number) {
  return clamp01((value - GAME_RULES.WORLD_MIN) / (GAME_RULES.WORLD_MAX - GAME_RULES.WORLD_MIN));
}

function worldToTextureY(value: number) {
  return 1 - worldToTextureCoord(value);
}

function radiusWorldToPixels(radius: number) {
  return radius / (GAME_RULES.WORLD_MAX - GAME_RULES.WORLD_MIN) * FOW_TEXTURE_SIZE;
}

export class FogOfWarOverlay {
  public readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly timeUniform = { value: 0 };
  private lastSignature = "";
  private visibilityPixels: Uint8ClampedArray | null = null;

  public constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = FOW_TEXTURE_SIZE;
    this.canvas.height = FOW_TEXTURE_SIZE;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Fog of war canvas context unavailable");
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;

    const planeSize = GAME_RULES.WORLD_MAX - GAME_RULES.WORLD_MIN + FOW_PLANE_MARGIN * 2;
    const geometry = new THREE.PlaneGeometry(planeSize, planeSize, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        fogTex: { value: this.texture },
        time: this.timeUniform,
        worldMin: { value: GAME_RULES.WORLD_MIN },
        worldMax: { value: GAME_RULES.WORLD_MAX },
        fogColor: { value: FOW_FOG_COLOR },
        fogColorDeep: { value: FOW_FOG_COLOR_DEEP },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform sampler2D fogTex;
        uniform float time;
        uniform float worldMin;
        uniform float worldMax;
        uniform vec3 fogColor;
        uniform vec3 fogColorDeep;
        varying vec3 vWorldPos;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }

        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.5;
          for (int i = 0; i < 4; i++) {
            value += noise(p) * amplitude;
            p *= 2.03;
            amplitude *= 0.5;
          }
          return value;
        }

        void main() {
          vec2 uv = (vWorldPos.xz - vec2(worldMin)) / (worldMax - worldMin);
          float inBounds = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
          float vis = inBounds > 0.5 ? texture2D(fogTex, clamp(uv, 0.0, 1.0)).r : 0.0;
          float visSoft = smoothstep(0.08, 0.88, vis);
          float hidden = 1.0 - visSoft;
          float cloudNoiseA = fbm(vWorldPos.xz * 0.013 + vec2(time * 0.019, -time * 0.014));
          float cloudNoiseB = fbm(vWorldPos.xz * 0.027 + vec2(-time * 0.024, time * 0.018));
          float cloudNoise = mix(cloudNoiseA, cloudNoiseB, 0.36);
          float cloudBody = smoothstep(0.34, 0.78, cloudNoise);
          float cloudWisps = smoothstep(0.52, 0.78, cloudNoiseA * 0.82 + cloudNoiseB * 0.18);
          float cloudShadow = smoothstep(0.42, 0.86, cloudNoiseB);
          float worldEdge = smoothstep(0.0, 0.08, min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y)));
          float edgeHidden = mix(1.0, hidden, inBounds);
          float fog = mix(edgeHidden, hidden, worldEdge);
          float cloudAlpha = 0.28 + cloudBody * 0.24 + cloudWisps * 0.16;
          float alpha = hidden * fog * cloudAlpha;
          vec3 cloudColor = mix(fogColor, fogColorDeep, clamp(cloudBody * 0.78 + cloudShadow * 0.42, 0.0, 1.0));
          if (alpha <= 0.01) discard;
          gl_FragColor = vec4(cloudColor, alpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(0, FOW_PLANE_Y, 0);
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
  }

  public update(game: Game, nowSec: number): void {
    this.timeUniform.value = nowSec;
    const signatureParts: string[] = [];
    game.room.state.blobs.forEach((blob, id) => {
      const candidate = blob as { ownerId?: string; x?: number; y?: number; unitCount?: number };
      if (candidate.ownerId !== game.room.sessionId) return;
      signatureParts.push(
        `b:${id}:${Math.round((candidate.x ?? 0) * 0.5)}:${Math.round((candidate.y ?? 0) * 0.5)}:${candidate.unitCount ?? 0}`
      );
    });
    game.room.state.buildings.forEach((building, id) => {
      const candidate = building as { ownerId?: string; x?: number; y?: number; buildingType?: BuildingTypeValue };
      if (candidate.ownerId !== game.room.sessionId) return;
      signatureParts.push(
        `d:${id}:${Math.round((candidate.x ?? 0) * 0.5)}:${Math.round((candidate.y ?? 0) * 0.5)}:${candidate.buildingType ?? 0}`
      );
    });
    const signature = signatureParts.join("|");
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, FOW_TEXTURE_SIZE, FOW_TEXTURE_SIZE);
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(0, 0, FOW_TEXTURE_SIZE, FOW_TEXTURE_SIZE);
    ctx.globalCompositeOperation = "lighter";

    game.room.state.buildings.forEach((building) => {
      const candidate = building as { ownerId?: string; x?: number; y?: number; buildingType?: BuildingTypeValue };
      if (candidate.ownerId !== game.room.sessionId) return;
      const x = worldToTextureCoord(candidate.x ?? 0) * FOW_TEXTURE_SIZE;
      const y = worldToTextureY(candidate.y ?? 0) * FOW_TEXTURE_SIZE;
      const rules = getBuildingRules((candidate.buildingType ?? 0) as BuildingTypeValue);
      const radiusWorld = Math.max(52, Math.max(rules.selectionWidth, rules.selectionDepth) * 4.6);
      smoothCircle(ctx, x, y, radiusWorldToPixels(radiusWorld), 0.95);
    });

    game.room.state.blobs.forEach((blob) => {
      const candidate = blob as { ownerId?: string; x?: number; y?: number; unitCount?: number };
      if (candidate.ownerId !== game.room.sessionId) return;
      const x = worldToTextureCoord(candidate.x ?? 0) * FOW_TEXTURE_SIZE;
      const y = worldToTextureY(candidate.y ?? 0) * FOW_TEXTURE_SIZE;
      const radiusWorld = 48 + Math.min(34, Math.sqrt(Math.max(1, candidate.unitCount ?? 1)) * 7.6);
      smoothCircle(ctx, x, y, radiusWorldToPixels(radiusWorld), 1);
    });

    ctx.globalCompositeOperation = "source-over";
    this.visibilityPixels = ctx.getImageData(0, 0, FOW_TEXTURE_SIZE, FOW_TEXTURE_SIZE).data;
    this.texture.needsUpdate = true;
  }

  public isWorldVisible(x: number, z: number): boolean {
    const uvx = worldToTextureCoord(x);
    const uvy = worldToTextureY(z);
    if (uvx <= 0 || uvx >= 1 || uvy <= 0 || uvy >= 1) return false;
    const pixels = this.visibilityPixels;
    if (!pixels) return true;
    const px = Math.max(0, Math.min(FOW_TEXTURE_SIZE - 1, Math.round(uvx * (FOW_TEXTURE_SIZE - 1))));
    const py = Math.max(0, Math.min(FOW_TEXTURE_SIZE - 1, Math.round(uvy * (FOW_TEXTURE_SIZE - 1))));
    const index = (py * FOW_TEXTURE_SIZE + px) * 4;
    return (pixels[index] ?? 0) >= 28;
  }
}
