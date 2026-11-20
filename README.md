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

## Cloud Run (browser app + MCP)

The Dockerfile now starts `bin/cloud-run.mjs` with Node.js on the Cloud Run `PORT`.
One origin serves the browser application, `POST /mcp` and the compatible `POST /api/mcp` endpoint.
It does **not** require a Vercel deployment. The legacy scene-store API is not hosted here.

```sh
# Authenticate with the Google Cloud project that owns spi3der before deploying:
gcloud run deploy spi3der --source . --region europe-west1 --allow-unauthenticated
# Check the actual Cloud Run service URL; do not guess the hostname:
gcloud run services describe spi3der --region europe-west1 --format='value(status.url)'
```

Use the returned service URL plus `/mcp` as the ChatGPT custom MCP server URL.
Test locally with `PORT=8080 node bin/cloud-run.mjs` and `node tests/cloud-run.mjs`.
A GitHub push alone does not deploy Cloud Run unless the project has configured its own deployment trigger.

## MCP debugging and timeout correlation

The `open_workshop` response returns a random `trace_id` in `structuredContent`
and in the textual tool result; the HTTP response also supplies `x-spi3der-trace-id`.
Use the MCP tool `debug_trace({trace_id})` to inspect a **recent** request.
Milestones include `request_received`, `model_started`, `model_finished`,
`scene_unpacked`, `response_ready` and `request_failed`.
Each event has elapsed milliseconds; the successful response records payload size
and scene object/vertex/face counts. Raw prompts, scenes, URLs and request bodies
are **not logged**.

The embedded widget optionally reports `widget_loaded`, `widget_rendered`,
`widget_empty`, or `widget_error` via `window.openai.callTool` when supported
by the host. **No widget feedback is not proof of a crash:** host sandboxes may
disallow callbacks, or rendering can time out before telemetry is delivered.
If the host times out before returning the response, inspect Cloud Run
structured logs for `component=spi3der-mcp` around the failure time instead.
Correlate using the `traceId` field (Cloud Run may have multiple instances).

Traces are deliberately metadata-only, kept **in memory for at most 15 minutes**
and limited to 128 per instance. `debug_trace` requires the unguessable trace ID;
there is no public endpoint listing other users' requests. For durable debugging,
use private Google Cloud Logging access. This cannot observe ChatGPT's internal
timeouts, only the stages that the server or widget actually reports.

To smoke-test locally:

```sh
npm run test:mcp-app
node tests/cloud-run.mjs
```

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
