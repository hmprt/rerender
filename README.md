# Rerender

Bare-bones standalone app for live SANA style transfer over game footage. Powered by Reactor.

Repo: `https://github.com/hmprt/rerender`

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
- `functions/api/reactor/token.js` is the Cloudflare Pages Function used in production.

## Deploy

```bash
npm run deploy
```

The Cloudflare Pages project is `rerender`, with `dist` as the build output. The included GitHub Actions workflow redeploys on pushes to `main` once the repository has these GitHub secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Production is deployed at `https://rerender.pages.dev`.

To put the custom domain live, add these proxied DNS records in the `rerender.app` Cloudflare zone:

- `CNAME @ -> rerender.pages.dev`
- `CNAME www -> rerender.pages.dev`

The Pages middleware redirects `www.rerender.app` to `rerender.app` with a `301` while preserving path/query.

Cloudflare Web Analytics can be enabled from the Pages project dashboard under Metrics. Pages will inject the beacon on the next deployment.
