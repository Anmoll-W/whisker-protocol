# Whisker Protocol

Whisker Protocol — Indian street cat stealth game for YouTube Playables

![Phaser 3](https://img.shields.io/badge/Phaser-3.x-blue?logo=phaser)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-8.x-646cff?logo=vite)

## About

A top-down stealth game where you play as a Mumbai street cat navigating alleys, dodging guards, and hunting food — built for YouTube Playables.

## Dev Setup

```bash
npm install
npm run dev
# Game runs at http://localhost:5173
```

## Build

```bash
# Standard build
npm run build

# YouTube Playables build (audio disabled on load, single-bundle)
npm run build:playables
```

Built output lands in `dist/`.

## Seeded RNG

All randomness uses the global seeded RNG. Never call `Math.random()`. Seed can be set via URL param for reproducible runs:

```
http://localhost:5173/?seed=my-seed
```

## Project Structure

```
src/
  scenes/     # Phaser scenes (Boot, Preload, Game, UI)
  entities/   # Cat, Guard, Food game objects
  systems/    # Detection, sound, movement, RNG
  types/      # TypeScript interfaces and global declarations
assets/
  sprites/    # Sprite sheets and atlases
  tilemaps/   # Tiled .tmx / .tsj map files
  audio/      # SFX and music
  fonts/      # Bitmap fonts
```

## Live Game

TBD — will be deployed at [whisker-protocol.pmcode.in](https://whisker-protocol.pmcode.in)

## License

MIT
