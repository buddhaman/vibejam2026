# AGI of Mythology Design System

## Design Context

### Users
Casual gamers and hobbyists discovering the game through jam listings, social links, or direct shares. They're playing for fun on whatever device they have — often mobile. First impressions matter: if it feels good in 5 seconds, they'll stay. No tutorial assumed, no patience for friction.

**Platform:** Desktop and mobile, touch-first. All interaction via single tap, double-tap, two-finger pan, and pinch-to-zoom. No right-click, no hover states, no keyboard shortcuts.

### Brand Personality
**Playful. Punchy. Bright.**

AGI of Mythology should feel like a game that's happy to exist — friendly shapes, saturated colors, confident simplicity. Inspired by *Snakebird*: that distinctive look of clean flat color, bold rounded forms, and a palette that's unapologetically vivid. It's an RTS, but it shouldn't feel like war — it should feel like toys coming to life.

### Aesthetic Direction
**Reference: Snakebird**
- Bright, fully saturated colors — not muted, not dark, not "gritty"
- Rounded, chunky shapes — blobs feel like characters, UI feels tactile
- Clean flat color over gradients (though subtle shading is fine in 3D)
- Soft, cheerful backgrounds — sky blues, warm grounds, not dark voids
- High contrast without harshness — legible at a glance, friendly to the eye

**In 3D:** Translate the Snakebird feel by using warm ambient lighting, saturated entity colors, cartoon-ish materials (low specular, high albedo), and a pastel sky. The ground can be a soft grass green. Avoid realistic textures, dark fog, or desaturated palettes.

**HUD:** Chunky canvas elements with bright fills, thick rounded borders, clear iconography. Feels more like a mobile game HUD than an RTS interface. Large tap targets (min 44px), generous spacing, no tiny text.

**Anti-references:** Dark military UI, realistic textures, desaturated "serious" RTS aesthetic, anything that looks like it needs a manual.

### Design Principles
1. **Bright over dark** — Default to light, warm, saturated colors. The current dark navy palette should shift toward the Snakebird sky-blue and soft ground tones.
2. **Round over sharp** — Blobs, buttons, menus: prefer generous border radii. Shapes should feel friendly and tactile.
3. **Touch-first always** — Every interactive element must be comfortably tappable with a thumb. Minimum 44px targets, no hover-dependent states.
4. **Readable at a glance** — Health, selection state, player color — all must be instantly legible without needing to study the screen.
5. **Personality through motion** — Squads have spring physics; the UI should feel equally alive. Subtle bounce, scale pops on tap, joyful transitions rather than instant cuts.
