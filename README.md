# Digger (Overhauled Edition)

A significantly upgraded browser digging simulation featuring:

- **Improved graphics** (depth shading, ambience, miner lantern glow)
- **Better UI** (resource pills, control bar, live upgrade panel)
- **Upgraded logic** (credit economy, smart target selection, progression upgrades)
- **Simulation controls** (pause, speed toggle, manual hiring)

## Run

```bash
python -m http.server 5173
```

Open <http://localhost:5173>.

## Gameplay loop

1. Dwarfs mine resources and haul them to base.
2. Deposits convert to **Credits**.
3. Spend credits on hiring and upgrades:
   - Auto Hire
   - Bigger Bags
   - Steel Picks
   - Lanterns
4. Push deeper and scale your mining colony.
