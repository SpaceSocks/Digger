# Digger (watchable dwarf digging sim)

A simple visual digging simulation/game: dwarfs dig into the ground, collect minerals until their bag is full, then return to the surface base to deposit resources. New dwarfs are hired automatically once you have enough gold.

## Run

- **Fastest (desktop)**: double-click `index.html` (works in most browsers).
- If your browser blocks local file access, run a tiny local server from this folder:

```bash
# Python
python -m http.server 5173
```

Then open `http://localhost:5173`.

## Run on your phone (same Wi‑Fi)

1. Start the local server on your computer:

```bash
python -m http.server 5173 --bind 0.0.0.0
```

2. Find your computer's LAN IP address:
   - macOS/Linux: `ip addr` or `ifconfig`
   - Windows: `ipconfig`

3. On your phone (connected to the same Wi‑Fi), open:

```text
http://<YOUR_COMPUTER_IP>:5173
```

Example: `http://192.168.1.42:5173`

### If it doesn't load

- Make sure both devices are on the same network (no guest/isolated Wi‑Fi).
- Allow Python/server through your computer firewall.
- Verify the server is still running in your terminal.

## Controls

- **Reset world**: regenerates the underground.

## Notes

- Resources: **Stone, Coal, Iron, Gold, Diamond**
- Gold is both a tracked resource and the currency for hiring.
