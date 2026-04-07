# Greeks vs Michaelsoft — Graphics Direction Brainstorm

## Core aesthetic goal

Snakebird energy in 3D: bright, saturated, confident. Every element should read instantly at a glance — no muddy shadows, no washed-out flats. The world should feel like a toy, not a diorama.

---

## Ground surface

### Painted grass variation
Add a fourth high-frequency noise layer to `getGroundVertexColor` for micro-detail: small dark-green and yellow-green patches that read as grass variation from above. Zero performance cost, just another noise sample blended at the vertex color level.

### Snow / bright rock on mountain peaks
Above a height threshold in `getGroundVertexColor`, blend toward a bright cool white-blue vertex color. Simple one-liner addition to the existing blend logic, zero cost.

### Edge darkening on cliff tops (vertex AO)
During terrain mesh generation, compute a cheap ambient occlusion value per vertex based on adjacent tile heights. High tiles surrounded by lower ones get a darkening factor at their edges. Makes cliffs read cleanly and gives a sense of depth without any extra pass.

### Worn dirt paths
Track which tiles are walked over repeatedly (per-tile "traffic" counter in server state or client-side accumulation). High-traffic tiles gradually tint toward a desaturated earthy color. Creates organic-looking roads and visualizes where battles happened. Client-side blend via a tile color overlay.

---

## Foliage and surface decoration

### Ground decals (instanced quads)
Scatter a few thousand flat textured quads procedurally over the terrain: small white flowers, pebbles, fallen leaves, tiny mushrooms. Sit flush at y=0.02 using depthBias. One instanced draw call with a small texture atlas. Cull by distance (only render within ~60 world units of camera). Essentially free.

### Grass tufts (instanced cross geometry)
On FOREST tiles and lush grass tiles, place small cross-geometry tufts (two flat quads at 90°, like Minecraft grass). Catch directional light nicely and fill visual gaps between trees. Use the same `syncInstancedVariantSet` pattern already used for tree variants.

### Flower clusters
Tiny colored dot billboards on the ground — instanced flat circles or simple SpriteGeometry. Different dominant colors seeded from terrain noise per region (yellow fields, blue patches, red poppies). Very cheap, massive visual payoff.

---

## Depth and atmosphere

### Rim light on units
A second `DirectionalLight` from behind/above (opposite the sun, low intensity ~0.15–0.20, cool blue `0x80b8ff`). Traces the silhouette of units and buildings with a subtle halo. Classic cartoon technique for pop-out depth. Single light added to scene, negligible cost.

### Shadow color tinting
PCF shadows render as dark gray by default. To make them feel warm, tint the `HemisphereLight` ground color toward a slightly purple-blue (`0x8090c0`) — shadow areas receive mainly ground bounce, giving a warm-lit / cool-shadow interplay that reads as "depth" rather than just "dark area".

### Depth fog with color grade
Swap `THREE.Fog` for `THREE.FogExp2` for more natural atmospheric falloff. Slightly desaturate and shift the fog color toward a hazy blue-violet at the far horizon to reinforce depth layering.

### Subtle ground shadow blobs
For each unit, draw a soft dark ellipse decal on the terrain directly below it as a fake contact shadow. This is separate from the shadow map and always visible regardless of sun angle. Even a very faint one (opacity ~0.15) eliminates the "floating" feel.

---

## Buildings and units

### Cartoon outline pass
Render entity meshes a second time slightly scaled up (~1.04×) with a flat back-face-only shader in a dark outline color. Classic NPR technique. For 50–100 entities this is negligible. Gives the Snakebird "drawn object" feel immediately.

### Team-colored ground projection
Each squad has an oval ring. Adding a very short-range `PointLight` at ground level in the team color (only for the selected squad, range ~8 units) would cast a subtle color pool on the ground around the unit. Costs one light but looks magical.

### Unit material saturation
Current phalanx models use PBR materials. Slightly increase the emissive value on unit materials (very low, ~0.05 in team color) so they maintain their color even in deep shadow and don't go muddy brown/black. Keeps the Snakebird "always readable" quality.

---

## Sky and horizon

### Gradient sky sphere
Replace the flat `setClearColor` with a large inverted sphere using a vertical gradient material — deep saturated blue at the top, pale warm yellow-white at the horizon. No texture needed, just a vertex shader gradient. Gives tremendous perceived depth for essentially free.

### Cloud layer
A few large flat plane meshes very high up (y=200+) with a soft alpha-blended cloud texture (or procedurally generated). Move slowly over time for life. Cast no shadows (just visual). Makes the world feel inhabited.

---

---

## Shaders and post-processing

### Screen-space ambient occlusion (SSAO)
Three.js has a built-in `SSAOPass` via `EffectComposer`. Drop it in after the main render pass. Parameters: radius ~4 world units, intensity ~0.4, minDistance 0.001. SSAO will darken the bases of buildings, the roots of trees, and the ground beneath squads automatically — gives a strong sense of depth and mass for essentially free. The output can be subtly blended (opacity 0.5) to avoid the "gray haze" look. Pairs perfectly with the cartoon outline pass since both reinforce object silhouettes.

### Cel / toon shading with custom GLSL
Replace `MeshStandardMaterial` on unit models with a custom `ShaderMaterial` that quantizes the diffuse term into 3–4 bands (dark, midtone, bright, specular highlight). Classic anime/cartoon look. The shader reads `vNormal` and the directional light direction in view space, computes `NdotL`, then `step()`s it into bands. Cost: one extra shader compile, zero runtime overhead. No more muddy PBR gradients — just clean flat color + highlight.

### Rim light shader injection
Custom `onBeforeCompile` hook on the phalanx/building materials — inject a rim term (`pow(1.0 - abs(dot(vNormal, viewDir)), 3.0)`) into the fragment shader. This is the soft version: no second DirectionalLight needed, zero draw calls, and easily team-colored by passing a uniform.

### Heat shimmer / distortion pass
Over tiles that are on fire or around explosions: sample the back-buffer with a UV offset driven by a sin(time) wave (WebGL `GL_OES_texture_float` or three.js `EffectComposer` distortion pass). 4×4 pixel shimmer reads as heat without any particles. Use a stencil mask so it only applies in the radius of an active explosion.

### Geometry shader grass (instanced + vertex animated)
Grass tufts animated in the vertex shader: `pos.x += sin(time * 1.8 + pos.x * 0.4) * 0.04` — constant gentle sway. Since it's vertex-level there's zero CPU involvement after initial setup. Works with the existing instanced draw call pattern.

---

## Explosions and combat effects

### Particle explosion bursts
When a unit dies or takes heavy damage: spawn a burst of ~20–40 instanced quads (using an existing quad InstancedMesh pool) with initial velocities pointing outward in a hemisphere. Each particle has a lifetime (0.4–0.8s) and lerps from bright team color → orange → dark grey → transparent. Update in the main tick loop via a lightweight particle manager that only touches the 20–40 instances during active bursts. No physics library needed — simple ballistic arc `y += vy; vy -= gravity * dt`.

### Bodies flying (ragdoll sprites)
On unit death: detach the unit model from the squad and throw it with `vx = rand(-3,3), vy = rand(4,8), vz = rand(-3,3)`. Apply tumble rotation each frame. When it hits terrain height, bounce once (vy = -vy * 0.3) then slide to a stop. After 2 seconds fade opacity to 0 and remove. Only applies to the top body mesh (cylindrical torso + helmet) — the shield and sword can scatter separately. Very readable, zero physics engine.

### Ground scorch decal
After a battle ends on a tile, stamp a dark ellipse decal at y+0.02 (same as contact shadow blob) but larger and slightly desaturated/burnt-looking. Stays visible for 30–60 seconds then fades. Uses the same instanced flat quad approach as contact shadows — just a different texture slot in the atlas (a dark ashy circle).

### Screen flash on big hits
When the player's selected squad takes heavy damage: brief (80ms) white screen overlay at 0.15 opacity via a canvas 2D rect over the game canvas — drawn in `drawHUD`, cleared next frame. Feels impactful with zero 3D overhead.

### Impact sparks (BeamDrawer reuse)
On sword contact frame: draw 4–6 very short (length 0.3–0.6) beam segments radiating from the contact point in random directions. Bright white/yellow color. Only live for 1 frame (or 2 frames if you want them to "fall"). Because `BeamDrawer` is already cleared and rebuilt every frame, these cost nothing extra — just a handful of extra `drawBeam` calls per active fight.

---

## Ambient occlusion techniques

### Baked vertex AO on terrain
During `createTerrainMesh`, for each vertex sample the height of adjacent tiles. If neighbors are taller (the vertex is in a "valley" or at the base of a cliff), multiply the vertex color by a darkening factor (0.6–0.85). This is one extra pass over the tile map during terrain build — free at runtime. Mountains and cliff bases get natural darkening; the visual result looks like real AO without any shader.

### Per-building base AO ring
Each placed building: add a flat dark circle (radius ~1.5× footprint, `MeshBasicMaterial` black, opacity 0.18, depthWrite false) underneath it at y+0.02. Scales with the building. Purely cosmetic, looks like the building is firmly planted in the ground. Two triangles per building, one draw call if batched.

### SSAO via EffectComposer (see Shaders section)
The runtime SSAO pass handles dynamic objects (squads, trees, buildings) automatically — baked vertex AO handles the static terrain cheaply. Together they give full coverage.

---

## Performance notes

- All decal/grass/flower systems should use the existing `syncInstancedVariantSet` pattern and distance-cull aggressively
- Shadow map stays at 4096 (current) — increasing further hits memory hard; tune bias instead
- Rim light and outline pass are the highest-impact low-effort wins
- Contact shadow blobs (fake, always-visible ellipses drawn as flat instanced meshes) solve the "floating" problem even when the shadow map misses something
- Particle explosions: reuse a shared pool of ~512 instances across all concurrent explosions; never allocate at runtime
- SSAO radius should be world-space, not screen-space, so it doesn't scale weirdly at different zoom levels
