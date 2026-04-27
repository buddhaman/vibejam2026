# Performance Profile Notes

Last profiled: 2026-04-27, local dev build at `http://localhost:5175/?profile=1`.

## Telemetry

The temporary profiler is dev gated:

- It only activates when `import.meta.env.DEV` is true.
- In dev, it requires `?profile=1` or the matching localStorage flag.
- `?profile=0` disables it again.

Release production should therefore keep the optimized path. The profiler records startup sections, terrain/tile visual rebuilds, frame phase timings, and optional per-entity render timing.

## Current Findings

Startup and warmup are the visible performance problem, not steady-state terrain decoration.

Observed startup spikes:

- `BlobEntity.render()` first GLB-backed render: about `291-296ms` per affected blob.
- Combined first unit/model warmup frame: about `630-775ms`.
- `BuildingEntity.render()` first GLB-backed render: about `70-75ms`.
- Full terrain rebuild after chunk streaming: about `67-72ms`.
- Terrain mesh creation across loaded chunks: about `90-101ms` total.
- Asset loading after first render: normally about `365-400ms`, with occasional runs around `1s`.

Observed steady state after warmup:

- Total frame work: about `3.8-4.2ms`.
- `composer.render()`: about `3.1-3.5ms`, the main steady cost.
- Entity render: about `0.6ms`.
- Tile visuals while idle: about `0.01ms`.
- Rock rebuilds: about `0.6-1.0ms`.
- Foliage rebuilds: about `1.0ms`.

## Diagnosis

The biggest bottleneck is first-use unit and building rendering after GLB assets arrive. The likely cause is a combination of:

- rebuilding instanced GLB meshes after fallback meshes already rendered,
- creating selection outline instanced meshes,
- material/program shader compilation on first visible render,
- renderer upload of geometry/material state during the same frame as gameplay rendering.

Terrain and decorative tile visuals are acceptable for now. The 4x4 terrain subdivision adds rebuild cost, but it is not the dominant steady-frame issue.

## Proposed Solution

Do not optimize rocks or foliage first. Fix the model warmup path.

Recommended order:

1. Prewarm unit and building instanced meshes immediately after their assets load.
2. Precompile renderer materials/programs for unit and building variants before swapping them into visible entities.
3. Spread expensive mesh rebuild and outline creation over multiple frames, especially `BlobEntity.rebuildUnitModelMeshes()`.
4. Avoid rebuilding fallback-to-GLB meshes for every blob in the same frame. Use a small queue and process one or two entities per frame.
5. After the startup hitch is fixed, profile `composer.render()` and the outline pass, since that dominates steady-state frame time.

Success target:

- No single startup frame above `50ms`.
- Model asset swap should feel invisible or at most one minor hitch below `16-25ms`.
- Steady frame work should remain around `4ms` on the current test machine.
