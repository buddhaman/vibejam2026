import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GAME_RULES, getTileCenter } from "../../shared/game-rules.js";
import type { Game } from "./game.js";
import { createTerrainMesh, getTerrainHeightAt, type TileView } from "./terrain.js";
import { TileDebugOverlay } from "./tile-debug.js";
import { TileVisualManager } from "./tile-visuals.js";
import { RagdollFxSystem } from "./ragdoll-fx.js";
import { ArrowFxSystem } from "./arrow-fx.js";
import { BuildingDestructionFxSystem } from "./building-destruction-fx.js";
import { BeamDrawer } from "./beam-drawer.js";
import { BrightBeamDrawer } from "./bright-beam-drawer.js";
import { CentralServerRenderer } from "./central-server-renderer.js";
import { ChunkDebugOverlay } from "./chunk-debug-overlay.js";

const SCENE_ENVIRONMENT_INTENSITY = 0.08;

const SUN = {
  direction: new THREE.Vector3(-0.55, 1, -0.35).normalize(),
  intensity: 2.6,
  shadowRadius: 44,
  shadowDepth: 160,
  shadowDistance: 90,
  mapSize: 2048,
} as const;

export const CAMERA_CONFIG = {
  polarFromDownDeg: 55,
  azimuthDeg: 45,
  distanceStart: 165,
  distanceMin: 14,
  distanceMax: 420,
  zoomFactor: 1.035,
  fov: 52,
  arrowYawDegPerSec: 78,
  arrowPitchDegPerSec: 52,
  polarPitchMinDeg: 38,
  polarPitchMaxDeg: 72,
} as const;

export type CameraRig = {
  camera: THREE.PerspectiveCamera;
  lookTarget: THREE.Vector3;
  distance: number;
  polarFromDownDeg: number;
  azimuthDeg: number;
  arrowKeysHeld: Set<string>;
  placeCamera: () => void;
  applyArrowKeys: (dt: number) => void;
  zoom: (deltaY: number) => void;
  resize: (width: number, height: number) => void;
};

export type RenderWorld = {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  cameraRig: CameraRig;
  terrain: THREE.Mesh;
  rebuildTerrain: () => void;
  walkabilityOverlay: THREE.InstancedMesh;
  syncWalkabilityOverlay: (visible: boolean, force?: boolean) => void;
  tileDebug: TileDebugOverlay;
  chunkDebug: ChunkDebugOverlay;
  tileVisuals: TileVisualManager;
  ragdollFx: RagdollFxSystem;
  arrowFx: ArrowFxSystem;
  buildingDestructionFx: BuildingDestructionFxSystem;
  beamDrawer: BeamDrawer;
  brightBeamDrawer: BrightBeamDrawer;
  sunLight: THREE.DirectionalLight;
  centralServer: CentralServerRenderer;
};

export function createRenderWorld(game: Game): RenderWorld {
  const { scene } = game;
  const world = {} as RenderWorld;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;";
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x62c8ff, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.75;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0).texture;
  scene.environmentIntensity = SCENE_ENVIRONMENT_INTENSITY;
  pmrem.dispose();

  scene.fog = new THREE.Fog(0x62c8ff, 420, 1280);
  scene.add(new THREE.AmbientLight(0xfff0c0, 0.28));
  scene.add(new THREE.HemisphereLight(0x98d8ff, 0x72c83a, 0.68));

  const sunLight = new THREE.DirectionalLight(0xfff3d6, SUN.intensity);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.setScalar(SUN.mapSize);
  sunLight.shadow.bias = -0.0002;
  sunLight.shadow.normalBias = 0.004;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = SUN.shadowDepth;
  sunLight.shadow.camera.left = -SUN.shadowRadius;
  sunLight.shadow.camera.right = SUN.shadowRadius;
  sunLight.shadow.camera.top = SUN.shadowRadius;
  sunLight.shadow.camera.bottom = -SUN.shadowRadius;
  scene.add(sunLight);
  scene.add(sunLight.target);

  let terrain = createTerrainMesh(game.getTilesOrdered());
  scene.add(terrain);

  const walkabilityOverlay = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(GAME_RULES.TILE_SIZE * 0.9, GAME_RULES.TILE_SIZE * 0.9),
    new THREE.MeshBasicMaterial({
      color: 0xff5b49,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    Math.max(1, game.getTilesOrdered().length)
  );
  walkabilityOverlay.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  walkabilityOverlay.frustumCulled = false;
  walkabilityOverlay.count = 0;
  walkabilityOverlay.visible = false;
  scene.add(walkabilityOverlay);

  const walkTileDummy = new THREE.Object3D();
  function syncWalkabilityOverlay(visible: boolean, force = false) {
    if (!visible) return;
    if (!force && !game.consumeWalkabilityDirty()) return;
    let count = 0;
    const tiles = game.getTiles();
    for (const tile of game.getTilesOrdered()) {
      if (tile.canWalk) continue;
      const center = getTileCenter(tile.tx, tile.tz);
      walkTileDummy.position.set(center.x, getTerrainHeightAt(center.x, center.z, tiles) + 0.18, center.z);
      walkTileDummy.rotation.set(-Math.PI / 2, 0, 0);
      walkTileDummy.scale.setScalar(1);
      walkTileDummy.updateMatrix();
      walkabilityOverlay.setMatrixAt(count++, walkTileDummy.matrix);
    }
    walkabilityOverlay.count = count;
    walkabilityOverlay.instanceMatrix.needsUpdate = true;
  }

  function rebuildTerrain() {
    scene.remove(terrain);
    terrain.geometry.dispose();
    const material = terrain.material;
    if (Array.isArray(material)) {
      for (const mat of material) mat.dispose();
    } else {
      material.dispose();
    }
    terrain = createTerrainMesh(game.getTilesOrdered());
    scene.add(terrain);
    world.terrain = terrain;
  }

  const tileDebug = new TileDebugOverlay(game.getTilesOrdered(), game.getTiles());
  scene.add(tileDebug.root);

  const chunkDebug = new ChunkDebugOverlay();
  chunkDebug.root.visible = false;
  scene.add(chunkDebug.root);

  const tileVisuals = new TileVisualManager();
  scene.add(tileVisuals.root);

  const ragdollFx = new RagdollFxSystem();
  scene.add(ragdollFx.root);
  game.setRagdollFxSystem(ragdollFx);

  const arrowFx = new ArrowFxSystem();
  scene.add(arrowFx.root);
  game.setArrowFxSystem(arrowFx);

  const buildingDestructionFx = new BuildingDestructionFxSystem();
  scene.add(buildingDestructionFx.root);
  game.setBuildingDestructionFxSystem(buildingDestructionFx);

  const beamDrawer = new BeamDrawer(12_288);
  scene.add(beamDrawer.root);
  game.setBeamDrawer(beamDrawer);

  const brightBeamDrawer = new BrightBeamDrawer(6_144);
  scene.add(brightBeamDrawer.root);
  game.setBrightBeamDrawer(brightBeamDrawer);

  const centralServer = new CentralServerRenderer();
  scene.add(centralServer.root);
  centralServer.load();

  Object.assign(world, {
    renderer,
    canvas,
    cameraRig: createCameraRig(game, sunLight),
    terrain,
    rebuildTerrain,
    walkabilityOverlay,
    syncWalkabilityOverlay,
    tileDebug,
    chunkDebug,
    tileVisuals,
    ragdollFx,
    arrowFx,
    buildingDestructionFx,
    beamDrawer,
    brightBeamDrawer,
    sunLight,
    centralServer,
  });
  return world;
}

function createCameraRig(game: Game, sunLight: THREE.DirectionalLight): CameraRig {
  const camera = new THREE.PerspectiveCamera(
    CAMERA_CONFIG.fov,
    window.innerWidth / Math.max(window.innerHeight, 1),
    0.5,
    5200
  );
  camera.up.set(0, 1, 0);

  const myTownCenter = game.getMyTownCenterPosition();
  const lookTarget = new THREE.Vector3(myTownCenter?.x ?? 0, 0, myTownCenter?.z ?? 0);
  const shadowCenter = new THREE.Vector3();
  const shadowOffset = SUN.direction.clone().multiplyScalar(SUN.shadowDistance);
  const arrowKeysHeld = new Set<string>();

  const rig: CameraRig = {
    camera,
    lookTarget,
    distance: CAMERA_CONFIG.distanceStart,
    polarFromDownDeg: CAMERA_CONFIG.polarFromDownDeg,
    azimuthDeg: CAMERA_CONFIG.azimuthDeg,
    arrowKeysHeld,
    placeCamera,
    applyArrowKeys,
    zoom,
    resize,
  };

  function placeCamera() {
    const theta = THREE.MathUtils.degToRad(rig.polarFromDownDeg);
    const phi = THREE.MathUtils.degToRad(rig.azimuthDeg);
    camera.position.set(
      lookTarget.x + rig.distance * Math.sin(theta) * Math.sin(phi),
      lookTarget.y + rig.distance * Math.cos(theta),
      lookTarget.z + rig.distance * Math.sin(theta) * Math.cos(phi)
    );
    camera.lookAt(lookTarget);

    const forward = new THREE.Vector3(lookTarget.x - camera.position.x, 0, lookTarget.z - camera.position.z).normalize();
    shadowCenter.copy(lookTarget).addScaledVector(forward, SUN.shadowRadius * 0.35);
    sunLight.target.position.copy(shadowCenter);
    sunLight.position.copy(shadowCenter).add(shadowOffset);
    sunLight.target.updateMatrixWorld();
  }

  function applyArrowKeys(dt: number) {
    if (arrowKeysHeld.size === 0) return;
    if (arrowKeysHeld.has("ArrowLeft")) rig.azimuthDeg -= CAMERA_CONFIG.arrowYawDegPerSec * dt;
    if (arrowKeysHeld.has("ArrowRight")) rig.azimuthDeg += CAMERA_CONFIG.arrowYawDegPerSec * dt;
    if (arrowKeysHeld.has("ArrowUp")) {
      rig.polarFromDownDeg = THREE.MathUtils.clamp(
        rig.polarFromDownDeg - CAMERA_CONFIG.arrowPitchDegPerSec * dt,
        CAMERA_CONFIG.polarPitchMinDeg,
        CAMERA_CONFIG.polarPitchMaxDeg
      );
    }
    if (arrowKeysHeld.has("ArrowDown")) {
      rig.polarFromDownDeg = THREE.MathUtils.clamp(
        rig.polarFromDownDeg + CAMERA_CONFIG.arrowPitchDegPerSec * dt,
        CAMERA_CONFIG.polarPitchMinDeg,
        CAMERA_CONFIG.polarPitchMaxDeg
      );
    }
    placeCamera();
  }

  function zoom(deltaY: number) {
    const factor = deltaY < 0 ? CAMERA_CONFIG.zoomFactor : 1 / CAMERA_CONFIG.zoomFactor;
    rig.distance = THREE.MathUtils.clamp(
      rig.distance * factor,
      CAMERA_CONFIG.distanceMin,
      CAMERA_CONFIG.distanceMax
    );
    placeCamera();
  }

  function resize(width: number, height: number) {
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  }

  placeCamera();
  return rig;
}

export type FrameStats = {
  fps: number;
  ms: number;
  totalWorkMs: number;
  idleBudgetMs: number;
  syncMs: number;
  tileVisualsMs: number;
  entityRenderMs: number;
  beamFlushMs: number;
  sceneRenderMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  entities: number;
  beamBuckets: number;
  chunksLoaded: number;
  chunksTotal: number;
  chunksPending: number;
  chunkFirstMs: number | null;
  chunkSpawnMs: number | null;
  chunkFullMs: number | null;
};

export function createInitialFrameStats(): FrameStats {
  return {
    fps: 0,
    ms: 0,
    totalWorkMs: 0,
    idleBudgetMs: 0,
    syncMs: 0,
    tileVisualsMs: 0,
    entityRenderMs: 0,
    beamFlushMs: 0,
    sceneRenderMs: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    entities: 0,
    beamBuckets: 0,
    chunksLoaded: 0,
    chunksTotal: 0,
    chunksPending: 0,
    chunkFirstMs: null,
    chunkSpawnMs: null,
    chunkFullMs: null,
  };
}
