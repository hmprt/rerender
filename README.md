# SANA Game Stream

Bare-bones standalone app for live SANA style transfer over game footage.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:5175`, enter a Reactor key, capture a game window, and start the stream.

The app sends the key to its local token broker at `/api/reactor/token`; it does not commit or log keys. For local development, the server reads `REACTOR_API_KEY` from `~/.codex/secrets/x-api.env`; the legacy `REACTR_API_KEY` name is still accepted.

## Shape

- `src/App.tsx` is the standalone streaming UI.
- `server/index.ts` is the dedicated token broker and production static server.
- Vite proxies `/api` to the local server in development.

## Naming Shortlist

- **SANA Game Stream**: descriptive working name, low risk while the repo is still forming.
- **Game Repaint**: clear user promise, good for demos and search.
- **Playstyle Studio**: friendly, broader than one model.
- **Shadercast**: game-native feel, streaming-forward.
- **Screenstyle**: generic but memorable, works beyond games.

Domain availability still needs a registrar check before we commit to one.
