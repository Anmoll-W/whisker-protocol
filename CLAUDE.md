# CLAUDE.md — Whisker Protocol

**Status:** Phase-1+L2 impl plan PANEL-VETTED (r2, all 6 personas APPROVE-WITH-CHANGES) + Anmoll-approved (full-commit, no kill criterion). **READY TO BUILD — start a fresh session and execute the BUILD KICKOFF block.** (2026-05-30)
**Design spec (read first):** `…/Aw Vault/Projects/PM-Code/knowledge/whisker-protocol-cat-chaos-design.md`
**Plan of record (BUILD FROM THIS):** `…/Aw Vault/Projects/PM-Code/knowledge/whisker-protocol-impl-plan-phase1-L2.md` (r2 — has asset math, A0 contract phase, L2 gate, "▶ BUILD KICKOFF — START HERE" block). Art decision: Pillow + heavy code-shading; AI-polish = gated L2 lever.
**Prior plan layer:** `…/whisker-protocol-tasks.md` (v2 phases) · `…/whisker-protocol-cat-chaos-design.md` (design layer).
**Mandate (user, 2026-05-25):** "Win awards, played worldwide. Whatever it takes."

## Cat Chaos design (2026-05-30) — what changed since vision-lock

- **Hook:** Cat Chaos — bat props (brass/clay/bottle) off ledges → noise lures guards. THE hero verb (panel-validated, all 6 personas).
- **Cat-behavior mechanics:** stillness=stealth, gap-squeeze, hidey-holes, tail-as-HUD, chirp-at-laddoo. Startle reflex = slice-optional.
- **Retention:** Star grades (★/★★/★★★ ghost-run) + Nine Lives (persist across tab refresh; mid-run safety valve) + **daily-seed challenge in v1**.
- **Worldwide unlock:** game-STATE feedback is universal visual+sound; Hindi = flavor only, never load-bearing.
- **Build gate:** L2 vertical slice to final quality FIRST. Gate = defined rubric + independent panel before slice · ≥9.0 · unprompted-bat-in-60s · **bundle audit parallel** · 60fps mid-range Android · portrait one-thumb tester.
- **Before any code:** asset-pipeline math (atlas/audio budget vs 8MB) must be in the plan.

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
| 0 — Vision Lock | DONE — art-direction.md + sprite_gen.py Billu candidates committed |
| Plan — Phase-1+L2 impl plan | DONE — panel-vetted r2, Anmoll-approved, READY TO BUILD |
| 1 — Asset Pipeline (A0 contract → Tracks A/B/C) | NEXT — start fresh session, run BUILD KICKOFF |
| 2 — Sprite Foundation | after L2 gate |
| 3 — Level Design (L1/3/4/5 + Daily Challenge) | after L2 gate |
| 4 — Juice + Polish | folded into L2 slice + later levels |
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
