# Plan: Whisker Protocol — YouTube Playables Game

**Type:** Plan
**Audience:** Anmoll (PM + builder) — execution reference for AI-assisted development
**Goal:** Ship a browser-based stealth game with an Indian cat identity to YouTube Playables. Use it as pmcode.in's flagship product and case study to attract gaming studio consulting clients.

---

## Context

Stealth Master (25M+ downloads, on YouTube Playables) has three clear failure modes: missions feel identical after 15–20 levels, progression is weapon-only, and stealth mechanics are shallow. The opportunity is a meaningfully better stealth game with a distinctive cultural identity — **Indian street cats** — that no competitor has touched.

The Indian angle is strategic, not cosmetic: India is one of YouTube Playables' 7 launch countries, Indian cat breeds and names (Billu, Kali, Bagha) carry genuine emotional resonance with the target audience, and cat behavior naturally maps to stealth mechanics (stalking, hiding, pouncing, silent movement). The core objective — steal food without getting caught — is universally relatable and culturally specific simultaneously.

**Window context (from indie developer who shipped to YouTube Playables):** Visibility is indie-friendly right now. Once monetization launches, big companies dominate the shelf. Ship in 8 weeks, not 6 months.

---

## Game Concept: Whisker Protocol

**Premise:** You are an Indian street cat (Desi cat or breed of choice) navigating richly Indian environments — chawls, bazaars, temples, wedding halls, railway stations — stealing food and surviving without being caught.

**Core objective:** Steal the food. Reach the exit. Don't get caught. Each level has a specific food target (laddoo from the kitchen, fish from the market, biryani from the wedding) with escalating guard complexity.

### Why this wins over Stealth Master

| Stealth Master | Whisker Protocol |
|---|---|
| Generic ninja — no identity | Indian cat — culturally specific, immediately memorable |
| Eliminate guards (violent) | Steal food (playful, cat-native, family-friendly) |
| Same mission type: eliminate | 3+ objective types: steal, ghost run, deliver, distract |
| Guard detection only | Detection + sound + smell (food-based aggravation) + surface noise |
| Weapon progression only | Breed abilities + learned skills + environment tools |
| No cultural texture | Indian environments, sounds, food items, guard types |

### Indian cat roster (breeds + names)

| Cat | Breed | Personality | Special Ability |
|---|---|---|---|
| **Billu** | Indian Desi (street) | Street-smart, fast | Parkour — scales walls quickly |
| **Kali** | Bombay Cat (black) | Silent, nocturnal | Vanish — brief invisibility in shadows |
| **Moti** | Persian | Slow but charming | Purr Distraction — freezes guards momentarily |
| **Bagha** | Bengal | Aggressive, agile | Pounce — long-range dash to cover |
| **Chhotu** | Indian native (kitten) | Small, unpredictable | Squeeze — fits through gaps others can't |

Each cat has a base stat spread (speed / noise / detection avoidance) plus one signature ability. Unlock through gameplay, not IAP.

### Cat-first mechanics

| Mechanic | How it works |
|---|---|
| **Surface noise** | Tiles carry noise values — marble (loud), carpet (silent), water puddle (very loud) |
| **Food smell radius** | Guards near food sources have extended alert range — carrying stolen food increases your detection radius |
| **Distraction objects** | Knock over a vessel, bat a ball of yarn, knock an item off a shelf — guards investigate |
| **Vent / gap traversal** | Cat-only passages — guards cannot follow |
| **Freeze reflex** | Hold still in shadow — detection cone passes over if you don't move |
| **Hunger meter** | Cat needs food to maintain speed; eating some of the stolen food restores meter but reduces score |

### Environments (Indian-specific)

1. **The Chawl Kitchen** — cramped, multiple households, guards = nosy neighbors
2. **The Bazaar** — open-air, chaotic, guards = shopkeepers and stray dogs
3. **The Wedding Hall** — high-value food targets, guards = caterers and security
4. **The Railway Station** — large open space, guards = railway staff and police
5. **The Temple Courtyard** — prasad as food target, guards = priests and devotees

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Game framework | **Phaser.js 3** | HTML5-native, YouTube Playables compatible, Claude-codeable |
| Level design | **Tiled Map Editor** (.tmx → Phaser) | Visual level building, no code for layouts |
| Build tool | **Vite** | Fast dev server, ES module bundling |
| Language | **TypeScript** | Type safety for AI-assisted development |
| Art style | **Pixel art, top-down 2D** | AI-generatable (Midjourney), readable at all sizes, fast to produce |
| Audio | **Howler.js** | Lightweight, browser-compatible |
| Hosting | **Vercel** | Already in stack, zero-config for Vite output, auto-preview URLs |
| Repo | **GitHub (public)** — `pmcode-in/whisker-protocol` | Public build log, portfolio artifact, case study |
| Submission | YouTube Playables ZIP bundle | Via developer interest form (submit immediately) |

**Bundle target:** Initial load <15 MB (SHOULD per Playables spec). Phaser 3 minified = ~670 KB. Art + audio budget = ~10–12 MB.

---

## pmcode.in Brand Integration

- Splash screen: "A Whisker Protocol game by pmcode.in" (no logos per Playables rules — text only in-game, logo on Vercel hosted version)
- GitHub repo: `github.com/pmcode-in/whisker-protocol` — public from day 1, weekly commits
- Case study page on pmcode.in website: "How we built a YouTube Playables game in 8 weeks" — live metrics, build log, certification process, lessons
- LinkedIn content (Maya): weekly build-in-public posts, launch post, post-acceptance update

---

## Build Phases

### Phase 1 — Core Loop (Week 1–2)
- [ ] Phaser 3 + Vite + TypeScript scaffold in `pmcode-in/whisker-protocol`
- [ ] Tiled map integration — first environment (The Chawl Kitchen)
- [ ] Billu (Desi cat) player: movement, animation states (walk/crouch/freeze)
- [ ] Guard entity: patrol waypoints, idle state
- [ ] Line-of-sight detection cone (configurable angle + range)
- [ ] Alert state machine: `unaware → suspicious → alerted → searching → patrol`
- [ ] Surface noise system (tile property → noise multiplier)
- [ ] Game over on detection + restart flow
- [ ] Food target: place item → reach it → collect → reach exit

**Exit criteria:** Cat moves on a map, gets spotted, triggers game over. Food collection works end-to-end.

### Phase 2 — Stealth Depth (Week 3–4)
- [ ] Sound detection radius (guards hear footsteps + food carry noise)
- [ ] Knock-over interaction (distraction objects → sound event → guard investigates)
- [ ] Vent/gap traversal (cat-only passages)
- [ ] Freeze ability with cooldown
- [ ] 5 levels across 2 environments (Chawl, Bazaar)
- [ ] Kali (Bombay Cat) + shadow vanish ability

**Exit criteria:** 5 completable levels with distinct stealth puzzle per level.

### Phase 3 — Breed System + Mission Variety (Week 5–6)
- [ ] Full cat roster: Billu, Kali, Moti, Bagha, Chhotu (unlock via gameplay)
- [ ] Breed abilities implemented + balanced
- [ ] 3 objective types: Steal (default), Ghost run (no alert triggered), Deliver (bring item to specific spot)
- [ ] Level rating: S/A/B/C/F (alerts triggered × time × food taken)
- [ ] 15 levels across 3 environments (Chawl, Bazaar, Wedding Hall)
- [ ] Hunger meter system

**Exit criteria:** 15 distinct levels, all 3 objective types, all 5 cats playable, rating screen works.

### Phase 4 — Polish + Submission (Week 7–8)
- [ ] Main menu, level select, settings
- [ ] Tutorial level (guided first-play, Billu in Chawl)
- [ ] Audio: ambient Indian sounds per environment, alert cues, cat sounds
- [ ] Mobile touch controls (D-pad + action button, all aspect ratios 9:32 to 32:9)
- [ ] Performance audit: 60fps Chrome mobile, <5s load time, <512 MB JS heap
- [ ] ZIP bundle: <15 MB initial, relative paths only, <8,000 files
- [ ] Submit YouTube Playables interest form
- [ ] Vercel deploy: `whisker-protocol.pmcode.in`
- [ ] Case study draft (Maya)

**Exit criteria:** Polished game, ZIP passes all Playables technical requirements, form submitted.

---

## Guard AI State Machine

```
PATROL → SUSPICIOUS → ALERTED → SEARCHING → PATROL

PATROL → SUSPICIOUS:   player enters peripheral vision OR footstep sound detected
SUSPICIOUS → ALERTED:  player in cone >1.5s OR direct line-of-sight confirmed
ALERTED → SEARCHING:   player exits zone (guard moves to last known position)
SEARCHING → PATROL:    search timer expires (10s) with no re-detection

Food carry modifier: +20% detection range on all guards while food is held
```

---

## YouTube Playables Certification Checklist

- [ ] Initial bundle <15 MB (SHOULD) / <30 MB (MUST)
- [ ] Total file count <8,000
- [ ] Individual files <512 KB (SHOULD) / <30 MB (MUST)
- [ ] Saved game data <500 KB (SHOULD) / <3 MB (MUST)
- [ ] Loads + interactive in <5 seconds
- [ ] Peak JS heap <512 MB
- [ ] All filenames: alphanumeric + `_`, `-`, `.` only
- [ ] Relative paths only — no absolute paths
- [ ] Touch AND mouse input for all interactions
- [ ] Keyboard directional input supported
- [ ] All aspect ratios 9:32 to 32:9 playable
- [ ] No third-party ads, IAP, or external links
- [ ] No in-game exit/quit button
- [ ] No YouTube UI mimicry
- [ ] No branding in thumbnail, title, or description
- [ ] Tested: Chrome + Safari + Firefox desktop, Android YouTube app, iOS YouTube app
- [ ] Submit form: https://docs.google.com/forms/d/e/1FAIpQLSdvdQ0lgIq2369aemj1O6w8R8FwGn9O5ARRGODDDUbVINCRJQ/viewform

**Certification timeline (from indie developer who shipped):** 10 days to 2 weeks. Submit as early as possible.

---

## Maya Content Plan (Build in Public)

| Week | Post | Format |
|---|---|---|
| 1 | "We're building an Indian cat stealth game for YouTube Playables" | Short |
| 2 | First gameplay clip — Billu in the Chawl | Short + video |
| 4 | "Here's what YouTube Playables requires technically" | Essay |
| 6 | Full cat roster reveal — Billu, Kali, Moti, Bagha, Chhotu | Carousel |
| 8 | "Whisker Protocol is submitted. Here's what we learned" | Essay |
| Post-acceptance | "It's live. Here's the full 8-week build log + numbers" | Case study essay |

---

## Vercel Hosting Plan

- Dev: auto-preview URL per branch (Vercel default)
- Staging: `staging.whisker-protocol.pmcode.in`
- Production: `whisker-protocol.pmcode.in`
- Separate from YouTube Playables ZIP — Vercel version can include IAP (Stripe) once game is accepted

---

## Verification

1. **Phase gate:** Each phase has exit criteria — do not start next phase until met
2. **Playtest after each phase:** Share Vercel preview link, cold-play 5 levels
3. **Performance:** Chrome DevTools → 60fps, <5s load, <512 MB heap
4. **Cross-device test:** Android Chrome, iOS Safari, Desktop Chrome/Firefox
5. **Bundle audit before ZIP:** `vite build` output size check + file count
6. **Submission signal:** Google response to interest form = quality bar confirmed
