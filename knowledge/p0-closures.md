# P0 Closure Log — Whisker Protocol

**Doc type:** Postmortem / closure record.
**Audience:** Whisker Protocol engineering (Alex) + QA (Vera) tracking P0 sign-off on `build/cat-chaos-pipeline`.
**Conclusion:** Both known P0 bugs are closed with test evidence. P0-1 (dead `_peripheralTime` accumulator) is fixed and pinned by a TDD repro that fails before the fix and passes after. P0-2 (WinScene/GameOverScene race) was already closed by `src/systems/scene-transition.ts`; this work confirms no regression.

---

## P0-1 — `_peripheralTime` dead accumulator

**Status:** CLOSED (2026-05-30).

### Symptom
The guard's peripheral-glimpse accumulator incremented every frame Billu sat in the cone's periphery, but nothing ever read it. A guard could watch Billu in his peripheral vision indefinitely and never react — the `PATROL → SUSPICIOUS (peripheral glimpse)` edge of the design stateDiagram was unreachable. Flagged independently by Sage, Vera, and Alex.

### Root cause
In the original `Guard.ts`, `updateDetection()` did `this._peripheralTime += delta` inside the `result.inPeripheral` branch, with an explicit comment "Peripheral detection does not drive SUSPICIOUS". No threshold check, no decay, no consumer. A write-only variable.

### Fix
State + timer logic was extracted into the pure, framework-free `src/systems/guard-brain.ts` (`GuardBrain`). The peripheral accumulator now has a full defined lifecycle:

| Behaviour | Implementation |
|---|---|
| **Trigger** | While `PATROL`/`IDLE`, once `_peripheralTime >= PERIPHERAL_TO_SUSPICIOUS_MS` (600 ms) the guard enters `SUSPICIOUS`. |
| **Decay** | While Billu is OUT of the periphery, `_peripheralTime` drains at `delta × PERIPHERAL_DECAY_FACTOR` (2×) — a brief edge flicker cannot bank toward SUSPICIOUS. |
| **Reset** | `_peripheralTime` is zeroed on **every** state change (in `setState`). |

Constants live in `src/types/guard-types.ts` (`PERIPHERAL_TO_SUSPICIOUS_MS`, `PERIPHERAL_DECAY_FACTOR`).

### Test evidence (TDD red → green)
Repro test: `src/systems/__tests__/guard-brain.test.ts` →
`P0 REPRO: continuous peripheral presence past threshold turns guard SUSPICIOUS`.

**Before the fix** (peripheral trigger removed, accumulator left write-only — the original bug):

```
✖ P0 REPRO: continuous peripheral presence past threshold turns guard SUSPICIOUS
  AssertionError: peripheral accumulator MUST trigger SUSPICIOUS at the threshold (dead-accumulator P0)
  ℹ pass 0   ℹ fail 1
```

**After the fix** (full suite):

```
✔ P0 REPRO: continuous peripheral presence past threshold turns guard SUSPICIOUS
✔ P0: a brief peripheral flicker below threshold does NOT trigger SUSPICIOUS
✔ P0: peripheralTime decays when Billu leaves the periphery
✔ P0: peripheralTime resets to 0 on a state change
ℹ tests 24   ℹ pass 24   ℹ fail 0
```

### Verification commands
```
npm test          # 24/24 pass, incl. 4 peripheral tests
npx tsc --noEmit  # clean
npm run lint      # clean
npm run build     # succeeds
```

---

## P0-2 — WinScene / GameOverScene race

**Status:** CLOSED prior to this work; **confirmed not regressed** (2026-05-30).

### Symptom
If Billu reached the exit on the same frame a guard caught him, `GameScene.update()` launched both `WinScene` and `GameOverScene`, producing undefined overlay stacking + duplicate `create()` calls.

### Closure
Fixed by `src/systems/scene-transition.ts`: a module-level `_transitioning` mutex. The first `transitionTo()` call in a frame wins; every subsequent call no-ops until the launched scene's `create` event clears the lock.

### Regression check (this work)
- `src/systems/scene-transition.ts` was **not modified** (`git diff --stat` empty).
- `GameScene` still routes BOTH the win-check (`transitionTo(this, 'WinScene')`) and the guard-alerted handler (`transitionTo(this, 'GameOverScene')`) through the mutex. Verified by grep — no direct `scene.launch`/`scene.start` for those overlays anywhere in `GameScene`.

---

## Glossary
- **`_peripheralTime`** — millisecond accumulator for how long Billu has been continuously in the guard's cone periphery with clear line of sight.
- **Periphery / peripheral cone** — the wider, shorter-range outer detection zone; a glimpse here is a soft trigger (SUSPICIOUS), distinct from the main cone (which drives ALERTED).
- **`GuardBrain`** — the Phaser-free decision core (`src/systems/guard-brain.ts`) owning all guard state + timers; the `Guard` entity delegates to it.
- **P0** — highest-severity bug class; blocks ship until closed with evidence.
