# Coresapian — Product Research Brief (for design grounding)

## What this is
A production-ready 3D first-person action-RPG playable in the browser, set across the nine realms of Norse mythology. The website is the game shell: title/landing experience, the fullscreen game page (WebGL canvas + HUD overlay), and supporting lore/codex surfaces. Always-online multiplayer via a dedicated server.

## The Nine Realms (canonical, from Norse cosmology)
1. **Midgard** — the human world: misty pine forests, fjords, wooden longhouses, standing stones.
2. **Jötunheim** — land of giants: jagged snow-capped peaks, frozen ruins, blizzards.
3. **Niflheim** — primordial mist/ice: glowing blue ice caves, fog banks, aurora light.
4. **Muspelheim** — primordial fire: lava fields, obsidian spires, ember storms, Surtr's realm.
5. **Alfheim** — light elves: luminous golden forests, bioluminescent flora, floating light motes.
6. **Svartalfheim** — dark elves/dwarves: bioluminescent caverns, crystal veins, forge-glow.
7. **Vanaheim** — Vanir gods: lush overgrown wilds, ancient groves, golden-hour haze.
8. **Asgard** — realm of the Æsir: golden halls, Bifröst rainbow bridge, storm-lit skies.
9. **Helheim** — realm of the dead: ashen grey wastes, pale green soul-lights, dead trees, fog.

## Aesthetic pillars (from product brief)
- Low-poly / stylized 3D world; strong fog and atmosphere per realm.
- **Runic CRT UI**: phosphor-glow interface, scanlines, runestone glyphs, dark stone/iron textures, etched-rune borders. Terminal-like readability, dark fantasy mood.
- Realm portals as major visual landmarks (glowing runic gates).
- Audio: procedural ambient drones per realm, Old-Norse-inspired vocal pads, positional environmental audio.

## Gameplay systems the UI must surface
- FPS movement, melee (axe/sword/hammer), shield block, bow, rune magic (4 schools), stamina/health/mana.
- RPG: XP/levels, skill tree, inventory grid, crafting, equipment, loot, realm-specific abilities.
- Enemies: draugr, wolves, trolls, valkyries, giants, realm bosses.
- Quests with branching dialogue, NPCs (shops, quest givers), factions, procedural world events/bosses.
- Multiplayer: always-online; remote players shown as glowing orbs with nametags; "Connecting to server…" banner with 3s auto-retry on disconnect; players spawn immediately on load.

## Technical facts (constraints on design)
- React 19 + Vite + Tailwind 3.4 shell; Three.js imperative engine for the 3D world; React renders HUD/menus as overlay.
- Dedicated Hono + WebSocket server (same origin, port 3000), Drizzle/MySQL persistence for characters.
- No login wall: players spawn immediately; identity is a locally-stored player ID + chosen display name.
- Build version stamp must appear on the loading screen; CSP-compliant (no external CDN assets at runtime); content-hashed static assets.
