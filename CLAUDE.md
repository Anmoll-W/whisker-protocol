# CLAUDE.md — Whisker Protocol

**Status:** Phase 1 prototype complete (2026-05-25). Persona panel: 5.3/10. Pivoting to award-winning overhaul.
**Plan of record:** `/Users/aw/Library/Mobile Documents/com~apple~CloudDocs/Obsidian/Aw Vault/Projects/Consulting-Venture/knowledge/whisker-protocol-tasks.md` (v2, 6-8 weeks)
**Mandate (user, 2026-05-25):** "Win awards, played worldwide. Whatever it takes."

## Hard constraints (locked 2026-05-25)

1. **Claude does 100% via code.** No Midjourney, Scenario, Suno, ElevenLabs, Aseprite, commissioned artists, CC0 packs, subscriptions, or paid services.
2. **Art** = Python + Pillow scripts in `tools/sprite_gen.py` → PNG sprite atlases in `public/sprites/`. Phaser loads as textures. No runtime `Graphics.fillRect`/`fillCircle` for character/tile rendering after Phase 2.
3. **Audio** = Python + numpy + scipy.io.wavfile in `tools/audio_gen.py` → WAV files in `public/audio/`. Music via Web Audio API runtime synthesis OR generated WAV loop. All Claude-authored.
4. **Bundle ≤15MB** (Playables limit). Target <8MB. Procedural audio keeps this small.
5. **Quality bar:** persona panel ≥9.0/10 before submission. No shipping a sub-9 build to hit a deadline.

## Stack

- Phaser 3.90 + Vite 8 + TypeScript 6
- `@/*` → `src/*` alias
- Seeded RNG only (`@/systems/rng`). `Math.random()` is BANNED. `Phaser.Math.Between` / `Phaser.Math.FloatBetween` also banned (they use Phaser's unseeded `Math.RND`).
- Build flags: `__PLAYABLES__` (set via Vite define) for Playables-specific paths
- Tools (NOT runtime deps): Python 3 + Pillow + numpy + scipy (in `tools/`)

## Commands

```bash
npm run dev          # Vite dev server at :5173
npm run build        # Standard build
npm run build:playables  # Playables build (single bundle, no audio on load)
npm run typecheck    # tsc --noEmit
npx tsc --noEmit     # same, no script alias

# Asset regeneration (run when sprite_gen.py or audio_gen.py changes)
python tools/sprite_gen.py --all
python tools/audio_gen.py --all
```

## Architecture (current)

```
src/
├── main.ts                  # Phaser config, scene list, RNG init
├── scenes/
│   ├── BootScene.ts         # entry → PreloadScene
│   ├── PreloadScene.ts      # asset loading (becomes real in Phase 2)
│   ├── GameScene.ts         # main gameplay
│   ├── GameOverScene.ts     # "PAKAD LIYA!" overlay
│   └── WinScene.ts          # "NIKAL GAYA!" overlay
├── entities/
│   ├── Player.ts            # Billu — to be sprite-refactored Phase 2
│   ├── Guard.ts             # patrol AI — to be sprite-refactored Phase 2
│   ├── TileMap.ts           # programmatic tiles — to become Tilemap from sprite sheet Phase 2
│   ├── FoodItem.ts          # laddoo
│   └── ExitZone.ts          # exit gate
├── systems/
│   ├── rng.ts               # seeded RandomDataGenerator
│   ├── detection.ts         # LOS cone + raycast
│   ├── detection-renderer.ts # debug overlay (gated off)
│   └── noise.ts             # surface noise computation
└── types/
    ├── tile-types.ts
    ├── player-types.ts
    └── guard-types.ts
```

## Editing discipline

- TileMap layout dimension assertion exists at `buildTiles()` — keep it
- Container + scene.make.graphics({}) pattern for any programmatic rendering left after Phase 2
- `g.scaleX = facingX` for left/right mirroring (NEVER manual coordinate flipping)
- Guard rendering: per-state visual variation (PATROL/IDLE/SUSPICIOUS/ALERTED/SEARCHING all distinct)
- Detection cone: takes `facingAngle` in radians (4-way), not `facingX: 1|-1` (2-way) — fix when refactoring Guard
- `_peripheralTime` MUST trigger SUSPICIOUS at threshold (Sage + Vera + Alex all flagged this dead accumulator)
- WinScene + GameOverScene need mutual exclusion (Vera flagged this race)

## Phase status (2026-05-25)

| Phase | Status |
|---|---|
| 0 — Vision Lock | NOT STARTED — write `art-direction.md` first |
| 1 — Asset Pipeline | NOT STARTED |
| 2 — Sprite Foundation | NOT STARTED |
| 3 — Level Design | NOT STARTED |
| 4 — Juice + Polish | NOT STARTED |
| 5 — Playtest | NOT STARTED |
| 6 — Submission | NOT STARTED |

## What was built in the prior arc (now to be rebuilt)

Phase 1 (8-task core loop, completed 2026-05-25, scored 5.3/10):
- Tilemap + Player + Guard + FoodItem + ExitZone + detection cone + state machine + game over/win overlays
- All programmatic Graphics rendering (the primary thing being replaced in Phase 2)
- ❌ No sprites, no audio, no HUD, no touch, no onboarding, no level select, peripheral detection bug, single level

## Documentation Standard

All docs follow `~/.claude/rules/doc-standard.md`. Every spec needs: doc type label, audience, ≥1 Mermaid diagram, glossary.

## Trigger phrases

- "whisker", "whisker protocol", "the game" → load this project + vault tasks
- "billu" → Player entity
- "chawl" → TileMap / level design
- "guard", "uncle" → Guard entity
- "playables" → YouTube Playables platform constraints
