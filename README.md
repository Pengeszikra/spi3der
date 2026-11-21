# spi3der

![spi3der spider artwork](media/spi3der-brand.svg)

Interactive 3D creation and exploration, powered by **3Draft**. Based on the 2026 Fifth Percent competition sprint.

The editor opens with **no scene** and **does not request VR** until you choose Enter XR. WebXR/Meta Quest and ViRtuSH hand interactions remain available. The scene picker offers **Globe**, **Deep Sky** and **Fifth Percent VR (LARK + Deep Sky)**. Model-format tooling is retained.

## ChatGPT-native MCP App Workshop (browser-local)

The **primary** spi3der workshop is a standalone HTML/JavaScript modeler inside the ChatGPT conversation, served as an MCP Apps resource `ui://spi3der/workshop-v1.html` (`text/html;profile=mcp-app`). It renders with **the existing `src/workshop-view.js` WebGL2 viewer** or a Canvas 2D fallback; all geometry operations run in the browser through `mcp/workshop-client.js`. The widget is self-contained: no JavaScript or geometry is fetched at runtime.

`open_workshop` is a **thin MCP command relay**. It validates and compresses declarative modeling steps and sends `structuredContent.steps` to the widget; it does not invoke the headless `build_model` engine or produce a mesh. A `trace_id` covers the MCP request. Successful modeling can be verified **only in the browser widget**, not merely from `response_ready`.

Supported browser-local tools: `add_box`, `add_extrusion`, `add_mesh`, `transform`, `move_vertices`, `extrude_face`, `recolor`, `remove`, `clear`, `list`, `inspect`, `get_mesh`, `group` and `ungroup`. **CSG, mechanics, sensing, character generation and surface placement are not yet ported** to this browser interpreter; they remain available in the separate legacy headless `build_model` tool, but not in `open_workshop`.

Continue editing by passing the previous response's `workshop_token` as `from`. The token contains compressed operation history, not a server session. The iframe rebuilds the model deterministically on each update; no shared server-side scene exists. A previous `#scene=` URL may also be supplied as a base scene. Use `npm run test:mcp-app` to check the interpreter, widget resource, continuation, and MCP trace contract.

Cloud Run is still needed to **register the MCP endpoint, deliver the widget HTML, and relay commands**. It is not needed for model computation or WebGL rendering. `api/mcp.mjs` lazily loads the old headless tool handler only if a legacy tool is requested. A source commit does **not** deploy Cloud Run: deploy the image and refresh/reconnect the ChatGPT custom plugin before testing this new widget.

The earlier `workshop.html` / `npm run workshop` shared-scene prototype is legacy diagnostics, not the product direction.

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
# Deploy exactly the current Git commit and expose its SHA in the UI + MCP widget:
gcloud run deploy spi3der --source . --region europe-west1 --allow-unauthenticated \
  --update-env-vars "SPI3DER_GIT_SHA=$(git rev-parse HEAD)"
# Check the actual Cloud Run service URL; do not guess the hostname:
gcloud run services describe spi3der --region europe-west1 --format='value(status.url)'
```

Use the returned service URL plus `/mcp` as the ChatGPT custom MCP server URL.
Test locally with `PORT=8080 node bin/cloud-run.mjs` and `node tests/cloud-run.mjs`.
A GitHub push alone does not deploy Cloud Run unless the project has configured its own deployment trigger.

`GET /api/version`, the main editor's build stamp, the MCP tool result, and
the embedded ChatGPT workshop now show the spi3der package version followed by
the actual build's Git commit (shortened to 8 characters in UI). The full
hash is available in the JSON response and browser title/debug panel.
The container excludes `.git`, so `SPI3DER_GIT_SHA` must be set on
deployment (the command above does that). If absent, the UI prints
`git ?` rather than guessing at the checked-out or latest GitHub commit.
Run the command from a clean checkout of the commit being deployed.

## MCP debugging and timeout correlation

The `open_workshop` response returns a random `trace_id` in `structuredContent`
and in the textual tool result; the HTTP response also supplies `x-spi3der-trace-id`.
Use the MCP tool `debug_trace({trace_id})` to inspect a **recent** request.
Milestones include `request_received`, `steps_validated`, `response_ready`
and `request_failed`. Each event records elapsed milliseconds and response
size. **The MCP server does not know vertex/face counts:** those are determined
in the browser widget. No raw prompts, meshes, URLs or request bodies are logged.

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

The package name is `spi3der`, with a CLI that hosts the app locally. The project uses its existing date-based `YY.M.DNNN` version scheme (`scripts/bump.mjs`) for npm releases as well.

```sh
npm run release -- --dry-run   # preview next date-based version, no changes
npm run release               # bump package.json, then npm publish
git add package.json
git commit -m "Release spi3der"
git push
```

Run `npm run release` instead of `npm publish`: direct publishing is guarded against accidentally reusing an existing version. The bump happens **before** npm constructs the tarball; npm's `prepublishOnly` hook runs too late to change the version npm has already chosen. Publication still requires your npm authentication and is not automatically triggered by a GitHub push. The project is licensed under MIT (see LICENSE).

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
