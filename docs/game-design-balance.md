# Game Design Balance

Last updated: 2026-04-25

This document is the living balance reference for `shared/game-rules.ts`. The game should stay fast paced: first combat should happen quickly, scouting and raids should matter, and static defense should buy time without locking the map.

## Economy Baseline

Agents move at `12` world units per second, carry `12` resources, spend `1s` picking up, and spend `1s` dropping off. Ordered forest and GPU gathering uses the carry loop, so distance matters more than the raw legacy idle gather constants.

Starting resources are `500 biomass`, `300 material`, and `200 compute`, with `3` starting agents and no free combat squads.

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

Costs below are full-squad effective costs. The code charges one unit at a time using `ceil(fullCost / unitCount)`, so these values are chosen to divide cleanly where possible.

| Unit | Squad size | Effective cost | Release full-squad time | Role |
| --- | ---: | ---: | ---: | --- |
| Agent | 1 | `45B` | `10.1s` | Economy worker. Cheap enough to recover quickly. |
| Hoplite | 12 | `120B / 36M / 72C` | `22.7s` | Durable melee line. Efficient in contact, but no longer the cheapest all-purpose answer. |
| Archer | 10 | `80B / 20M / 50C` | `16.2s` | Fast ranged pressure. Lower durability, better tempo, needs protection. |
| Synthaur | 6 | `126B / 30M / 96C` | `17.8s` | Fast shock unit. Expensive compute sink for raids, surrounds, and disengage plays. |

### Unit Combat Notes

Hoplites were the dominant meta because their old effective cost was only about `84B / 36C` per full squad and required no material. They now pay across all three resources and have slightly lower DPS per body, while keeping enough health to be the best front line.

Archers are intentionally faster to field than hoplites. Their range was trimmed from `34` to `32` so ranged blobs still kite, but do not dominate every approach.

Synthaurs train faster than before and hit slightly harder, but their compute cost is high. They should feel like a premium tempo unit, not the default army.

Agents train faster and cost less biomass so players can recover after raids and support future agent-built construction.

## Building And Defense Targets

Current buildings are placed instantly. When agent-built construction is added, use these target build durations as the starting point:

| Building | Current cost | Future build duration target | Design intent |
| --- | ---: | ---: | --- |
| Farm | `70M` | `8s` | Quick biomass setup, vulnerable to raids. |
| Barracks | `175M` | `18s` | Main melee tech; first combat path. |
| Archery Range | `150M / 30C` | `16s` | Faster tech switch with some compute commitment. |
| Stable | `210M / 80C` | `22s` | Premium tech path. |
| Tower | `125M / 50C` | `20s` | Defensive time-buying, not map lockdown. |

Tower range is now `48` world units plus the target blob radius, down from `92`. That is roughly `4` tiles before blob size, instead of almost `8` tiles. Tower damage is now `7 DPS`, down from `18 DPS`.

This means a tower threatens small raids and punishes dives, but it should not erase a full army by itself. Approximate solo time-to-kill from full health:

| Target | Approx health | Tower TTK |
| --- | ---: | ---: |
| Hoplite squad | `132` | `18.9s` |
| Archer squad | `80` | `11.4s` |
| Synthaur squad | `108` | `15.4s` |

## Debug Pacing

Development/debug keeps the same unit and building costs as release. Only pacing is accelerated through `server/src/config.ts`, where `UNIT_TRAIN_TIME_MULTIPLIER` is `0.1` in development. That keeps tests fast without teaching different cost muscle memory.

## Balance Watchlist

Watch whether the added material cost makes early barracks plus first army too material starved once agent-built construction lands. If it does, reduce Barracks build time before reducing hoplite material cost.

Watch whether towers still stall center fights. If they do, lower range first; keep damage high enough that lone raiders cannot ignore them.

Watch whether archers replace hoplites as the new default. If so, increase archer material from `20` to `30` before touching range again.
