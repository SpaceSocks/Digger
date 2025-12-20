# Digger (watchable dwarf digging sim)

A simple visual digging simulation/game: dwarfs dig into the ground, collect minerals until their bag is full, then return to the surface base to deposit resources. New dwarfs are hired automatically once you have enough gold.

## Run

- **Fastest**: double-click `index.html` (works in most browsers).
- If your browser blocks local file access, run a tiny local server from this folder:

```bash
# Python
python -m http.server 5173
```

Then open `http://localhost:5173`.

## Controls

- **Reset world**: regenerates the underground.

## Notes

- Resources: **Stone, Coal, Iron, Gold, Diamond**
- Gold is both a tracked resource and the currency for hiring.


