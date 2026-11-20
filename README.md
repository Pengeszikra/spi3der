# spi3Der

Interactive 3D creation and exploration, powered by **3Draft**. Based on the 2026 Fifth Percent competition sprint.

The editor opens with **no scene** and **does not request VR** until you choose Enter XR. WebXR/Meta Quest and ViRtuSH hand interactions remain available. The scene picker offers **Globe**, **Deep Sky** and **Fifth Percent VR (LARK + Deep Sky)**. Model-format tooling is retained.

## Run locally

```sh
npm install
npm start
# or, after publishing to npm:
npx spi3der
```

Open http://localhost:5173. No application build system is needed.

## Cloud Run (static)

```sh
gcloud run deploy spi3der --source . --region europe-west1 --allow-unauthenticated
```

The Dockerfile serves the browser application from nginx on port 8080, with correct ES module MIME types. **Note:** this static Cloud Run container does not execute Vercel API functions under `api/` (the scene store and MCP endpoint); deploy those functions separately, or provide a Node API server, if you need them on the same origin.

## npm

The package name is `spi3der`, with a CLI that hosts the app locally. The package is configured for `npm pack` / `npm publish` but is **not automatically published**. The project is licensed under MIT (see LICENSE).

## Compatibility

- `?scene=globe`, `?scene=deepsky` or `?scene=game:lark` explicitly loads a scene.
- `?autovr` explicitly enables the previous automatic headset VR offer.
- Desktop starts empty; use **Enter XR** to enter VR manually.

Original source: https://github.com/Pengeszikra/five-percent


## Workshop 001 — local AI ↔ Human ↔ 3D scene

Run:

```sh
npm install
npm run workshop
```

Open **http://localhost:5173/workshop.html**. This is an independent, local-first workshop prototype; it does not replace the existing `npm start` editor.

- **Human:** add named boxes, move/rotate/remove objects, inspect the deterministic 3Draft SVG render (perspective, front, side, top, four views), export the current scene JSON.
- **AI:** invoke any existing `mcp/scene.js` modelling tool through the local JSON-RPC MCP endpoint `http://localhost:5173/mcp` (POST), or call `POST /api/tool`.
- **Shared scene:** both routes use *one in-memory scene instance*. `GET /api/scene` returns it; `GET /api/events` sends Server-Sent Events after every successful edit so all open workshop tabs update.
- **Limits:** there is no authenticated remote cloud session, real-time reverse control of the original WebGL editor, import UI, persistence across restarts, or host-embedded ChatGPT canvas in this prototype. The viewer is a deterministic SVG preview, not the original interactive WebGL viewport. Only loopback (`127.0.0.1`) is served. The MCP endpoint is minimal JSON-RPC over HTTP and is **not** a complete Streamable HTTP MCP implementation. Do not expose it publicly.

Example browser/agent request:

```sh
curl -s http://localhost:5173/mcp -H 'Content-Type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"add_box","arguments":{"name":"ai-box","size":[1,1,1],"at":[2,0.5,0],"color":"#22cbd5"}}}'
```

The human sees the new object without refreshing. A human move is also immediately visible to the AI through `GET /api/scene` or the `list` MCP tool.

For more architecture detail see `AGENTS.md`, and for legacy MCP viewer functionality see `MCP.md`.
