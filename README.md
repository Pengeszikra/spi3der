# spi3der

![spi3der spider artwork](media/spi3der-brand.svg)

Interactive 3D creation and exploration, powered by **3Draft**. Based on the 2026 Fifth Percent competition sprint.

The editor opens with **no scene** and **does not request VR** until you choose Enter XR. WebXR/Meta Quest and ViRtuSH hand interactions remain available. The scene picker offers **Globe**, **Deep Sky** and **Fifth Percent VR (LARK + Deep Sky)**. Model-format tooling is retained.

## ChatGPT-native MCP App Workshop (current direction)

The **primary** spi3der workshop is a 3D viewport rendered **inside the ChatGPT conversation**, via the MCP Apps resource `ui://spi3der/workshop-v1.html` (`text/html;profile=mcp-app`). The `open_workshop` tool attaches `_meta.ui.resourceUri` and the ChatGPT compatibility key `openai/outputTemplate`; its output includes the scene geometry in `structuredContent`. No second editor or chatbot sidebar is required.

The embedded widget initially provides a simple shaded mesh view, orbit and zoom; camera state stays local to the widget. The agent generates/edit models with the 3Draft `build_model` operations and can call `open_workshop` with a sequence of steps and `from` pointing to an earlier model. The model currently travels in the MCP tool result, **not** through a persistent live multiplayer session. In-widget geometry manipulation and automatic bidirectional sync are not implemented yet.

Server: `api/mcp.mjs`, adapter: `mcp/workshop-app.js`, widget: `mcp/workshop-widget.js`, contract test: `npm run test:mcp-app`. For ChatGPT the remote MCP endpoint must be deployed and reconnected/refreshed as a custom plugin. Source commits alone do not enable the widget in a running ChatGPT conversation.

The earlier `workshop.html` / `npm run workshop` prototype is *legacy diagnostics*, not the product direction. Do not rebuild or polish its extra UI.

## Run locally

```sh
npm install
npm start
# or, after publishing to npm:
npx spi3der
```

Open http://localhost:5173. No application build system is needed.

## Project boundaries and deployments

- **spider-paint** (`Pengeszikra/Spider-Paint`) is the separate legacy project, deployed independently to Vercel and Cloud Run.
- **spi3der** (`Pengeszikra/spi3der`) is deployed to Cloud Run only, at `spi3der.run.app`, and has the `spi3der` npm package. There is no spi3der Vercel deployment.
- **3Draft** (`Pengeszikra/3Draft`) is the separate 3D engine repository and npm module.

The product name is always lowercase **spi3der**. The app header can retain **3Draft** as a quiet engine attribution.

## Cloud Run (static)

```sh
gcloud run deploy spi3der --source . --region europe-west1 --allow-unauthenticated
```

The Dockerfile serves the browser application from nginx on port 8080, with correct ES module MIME types. **Note:** the nginx Cloud Run container is static: it does not execute Node API functions under `api/` (the scene store and MCP endpoint). Provide a separate Node API server or a Cloud Run service configured to serve them; do not rely on a Vercel deployment for spi3der.

## npm

The package name is `spi3der`, with a CLI that hosts the app locally. The package is configured for `npm pack` / `npm publish` but is **not automatically published**. The project is licensed under MIT (see LICENSE).

## Compatibility

- `?scene=globe`, `?scene=deepsky` or `?scene=game:lark` explicitly loads a scene.
- `?autovr` explicitly enables the previous automatic headset VR offer.
- Desktop starts empty; use **Enter XR** to enter VR manually.

Original source: https://github.com/Pengeszikra/five-percent


## Legacy local Workshop 002 (diagnostics only)

```sh
npm install
npm run workshop
# open http://localhost:5173/workshop.html
```

This is a **local-first** shared scene with the existing 3Draft geometry kernel, not a second model format.

**Human in browser**: WebGL2 scene (drag to orbit, scroll to zoom, click to select), add/transform/rotate/remove named meshes, inspect deterministic SVG views, export JSON, and queue new instructions **while an agent is working**. The WebGL camera is *local to each browser*, not part of shared geometry.

**Agent in another terminal**: connect an MCP client to the same running Workshop instance through:

```json
{
  "mcpServers": {
    "spi3der-workshop": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/spi3der/bin/workshop-mcp.mjs"]
    }
  }
}
```

This stdio proxy forwards all MCP calls into the **one** running HTTP workshop process. There is no second scene. On the same machine: `npm run mcp:workshop`. The proxy accepts `SPI3DER_WORKSHOP_URL` if the HTTP endpoint is not on port 5173.

The agent should invoke ordinary 3Draft tools (`add_box`, `transform`, `render`, `inspect`, `list`, etc.) and periodically call **`workshop_messages`** to read new human instructions; **`workshop_reply`** acknowledges/responds to them. The browser's instruction box can take additional messages immediately, without cancelling scene operations. These messages are **not** auto-executed by a model: the connected agent has to poll them explicitly.

HTTP interface:
- `GET /api/scene`: scene state with monotonic revision
- `POST /api/tool`: execute a 3Draft tool against that scene
- `GET /api/events`: SSE changes to the shared scene and instruction queue
- `GET /api/version`, `GET /api/inbox`, `POST /api/inbox`, `POST /api/presence`, `GET /api/participants`
- `POST /mcp`: minimal JSON-RPC over HTTP, **not a complete Streamable HTTP MCP** transport; use the stdio bridge for MCP clients.

**Test:** `npm run test:workshop` exercises MCP → scene → browser API, instruction acknowledgments, participant presence and static-file protection.

**Current boundaries:** one process / one in-memory shared scene, no persistence across restart; no realtime editing link to the legacy full Spider Paint WebGL editor; no multi-user permission or concurrent edit locks; no agent background execution, no pause/resume coordinator; the HTTP MCP endpoint is a local prototype and is not authenticated. Only bind to 127.0.0.1. A host ChatGPT UI may not support embedding this external live viewer. No npm publish is implied by a Git commit.

Architecture and collaboration invariants live in `AGENTS.md`.
