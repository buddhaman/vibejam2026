# Game Design Balance

Last updated: 2026-04-26

This document is the living balance reference for `shared/game-rules.ts`. The game should stay fast paced: first combat should happen quickly, scouting and raids should matter, and static defense should buy time without locking the map.

## Economy Baseline

Agents move at `12` world units per second, carry `12` resources per body, spend `1s` picking up, and spend `1s` dropping off. Ordered forest and GPU gathering uses the carry loop, so distance matters more than the raw legacy idle gather constants. The default agent blob cap is `3`, so a full small work crew carries `36`.

Starting resources are `500 biomass`, `300 material`, and `200 compute`, with two `3`-agent starting blobs and no free combat squads. This lets the player immediately split one crew to construction and one crew to gathering.

### Distance Math

Dropoff radius around the Town Center is about `18.1` world units. Resource pickup reach is about `3.8` world units for forest/GPU tiles. A rough one-way travel time is:

```text
max(0, resourceDistance - dropoffRadius - gatherReach) / agentSpeed
```

Per-player forests spawn about `90` world units from the Town Center. That gives about `68` travel units each way, or `5.7s` before acceleration/pathing. A realistic round trip is about `14s`, so one agent gathers about `0.85 material/s`.

Per-player GPU sites spawn about `78` world units from the Town Center. That gives about `56` travel units each way, or `4.7s` before acceleration/pathing. A realistic round trip is about `12-13s`, so one agent gathers about `0.9-1.0 compute/s`.

Farms grow every `10s`. Harvesting takes `1s`, dropoff takes `1s`, and a well-placed farm still usually adds a short reposition. One agent on one nearby farm should average about `0.85-1.0 biomass/s`. Multiple agents on one farm are inefficient because growth gates the harvest.

### Strategic Implications

Material should not be only a building tech gate. Combat units now have small material costs so forest control matters and hoplite-only play cannot ignore the map.

Compute should remain the main limiter on advanced combat mass. The starting `200 compute` supports early aggression, but sustained production needs a GPU route.

Biomass should be the spam throttle. Farms are reliable but not explosive, so players must choose between more agents, more farms, and immediate army.

## Current Unit Targets

Training still produces one body at a time. Nearby bodies merge into larger blobs up to `targetSize`, which is the practical squad size the player sees and commands.

The code charges one trained body at a time using `ceil(referenceCost / referenceCount)`. The reference count is tuned to make the full target blob cheap enough for fast-paced mass battles without making a single early body free.

| Unit | Max blob | Per trained body | Full blob cost | Full blob train time | Role |
| --- | ---: | ---: | ---: | ---: | --- |
| Agent | 3 | `30B` | `90B` | `10.1s` | Economy crew. Small enough to split, large enough to reduce click clutter. |
| Hoplite | 32 | `7B / 2M / 4C` | `224B / 64M / 128C` | `25.7s` | Big durable melee line. Cheap per body, but the full blob needs all three resources. |
| Archer | 24 | `7B / 2M / 4C` | `168B / 48M / 96C` | `22.3s` | Large ranged pressure blob. Lower durability, strong tempo, needs protection. |
| Synthaur | 14 | `14B / 3M / 10C` | `196B / 42M / 140C` | `24.3s` | Fast shock blob. Premium compute sink for raids, surrounds, and disengage plays. |

### Unit Combat Notes

Hoplites were the dominant meta because their old trained-body cost was too low and required no material. They now pay across all three resources and have slightly lower DPS per body, while larger `32`-body blobs deliver the desired mass-battle look.

Archers are intentionally faster to field than hoplites. Their range was trimmed from `34` to `32` so ranged blobs still kite, but do not dominate every approach.

Synthaurs train faster than before and hit slightly harder, but their compute cost is high. They should feel like a premium tempo blob, not the default army.

Agents merge into `3`-body work crews so economy management has fewer tiny blobs while preserving one-body-at-a-time training.

## Building And Defense Targets

Buildings now place as scaffolds and complete when agents deliver construction blocks. A full `3`-agent blob carries `3` blocks, so block counts are tuned in multiples of three: one full-crew trip per tier. More agent blobs can work on the same building to trade attention/economy for faster tech.

| Building | Cost | Build blocks | Full-crew trips | Design intent |
| --- | ---: | ---: | ---: | --- |
| Farm | `70M` | `3` | `1` | Quick biomass setup. Cheap enough to expand immediately, still raidable before payoff. |
| Archery Range | `150M / 30C` | `6` | `2` | Fastest military tech switch. Compute cost is the commitment, construction should not lag behind Barracks. |
| Barracks | `175M` | `9` | `3` | Main melee tech and default first-combat path. Slower than Archery because it asks only material. |
| Tower | `125M / 50C` | `9` | `3` | Defensive time-buying. Equal build effort to Barracks prevents instant reactive tower walls. |
| Stable | `210M / 80C` | `12` | `4` | Premium tech path. Highest construction commitment matches high compute cost and raid potential. |

### Construction Tuning Notes

Keep block counts explicit rather than deriving them directly from resource totals. Resource cost and construction time do different jobs:

- Resource cost controls what economy route the player needs.
- Block count controls map exposure, worker commitment, and how interruptible the tech choice feels.
- Multiples of three keep the visuals and pacing legible because one full agent blob carries exactly one row of `3` blocks.

Initial targets:

- `3` blocks: one quick setup trip, only for farms.
- `6` blocks: fast tech switch, currently Archery Range.
- `9` blocks: standard tech/defense commitment, Barracks and Tower.
- `12` blocks: premium tech commitment, Stable.

Tower range is now `48` world units plus the target blob radius, down from `92`. That is roughly `4` tiles before blob size, instead of almost `8` tiles. Tower damage is now `7 DPS`, down from `18 DPS`.

This means a tower threatens small raids and punishes dives, but it should not erase a full army by itself. Approximate solo time-to-kill from full health:

| Target | Approx health | Tower TTK |
| --- | ---: | ---: |
| Hoplite blob | `352` | `50.3s` |
| Archer blob | `192` | `27.4s` |
| Synthaur blob | `252` | `36.0s` |

## Debug Pacing

Development/debug keeps the same unit and building costs as release. Only pacing is accelerated through `server/src/config.ts`, where `UNIT_TRAIN_TIME_MULTIPLIER` is `0.1` in development. That keeps tests fast without teaching different cost muscle memory.

## Balance Watchlist

Watch whether the added material cost makes early barracks plus first army too material starved now that Barracks also needs `9` build blocks. If it does, reduce Barracks blocks from `9` to `6` before reducing hoplite material cost.

Watch whether towers still stall center fights. If they do, lower range first; keep damage high enough that lone raiders cannot ignore them.

Watch whether archers replace hoplites as the new default. If so, increase archer material from `20` to `30` before touching range again.
