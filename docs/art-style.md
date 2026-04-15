# Art Style

AGI of Mythology is aiming for a stylized RTS look built around readability first:

- low-detail geometry
- bold hand-authored color blocks
- silhouette-first units and buildings
- fake richness from shading instead of micro-detail
- restrained emissive accents
- strong faction accents and clear ownership reads

## Current Rendering Direction

The renderer should commit to stylization instead of mixing realistic PBR materials with cartoon lighting. The baseline look is:

- 3-band toon diffuse shading
- subtle rim light to help units separate from terrain
- limited material variation
- low environment reflection contribution
- simple terrain colors that match the same stylized lighting model

This keeps the scene readable at RTS camera height and scales better as unit counts increase.

## In Scope Right Now

The current implementation pass is intentionally narrow:

- update shading only
- no outlines yet
- no decals yet
- no blood yet
- no extra combat FX expansion yet

That means the visual win should come from lighting response and banding, not from adding detail layers.

## Asset Guidance

When modeling or revising assets, prefer:

- chunkier primary forms
- exaggerated proportions
- fewer, thicker secondary details
- clean material separation
- flat painted albedo with restrained texture noise

Avoid treating high-frequency textures or realistic material response as the source of detail. If a model feels plain, solve that first with shape language and shading.

## Later Passes

Once the base shading is settled, the next sensible visual layers are:

1. inverted-hull outlines for units and key buildings
2. sparse emissive seams and accent strips
3. terrain decals or splat masks for blood, scorch, and interaction history
4. selective combat juice such as hit flashes, dust puffs, and short-lived burst particles

Those should build on top of the stylized base rather than replace it.
