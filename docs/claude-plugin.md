# spi3der in Claude

## Why a second view

The ChatGPT widget (`ui://spi3der/workshop-v8.html`) frames the editor from `https://spi3der.cloud.run`. Claude restricts frames inside MCP App views (`_meta.ui.csp.frameDomains`): they are blocked for Community directory listings, allowed only per listing for Verified ones, and available for custom connectors only to a limited set of organizations (https://claude.com/docs/connectors/building/mcp-apps/embedded-sites). So for Claude the editor must be the view itself.

## The inline view

`ui://spi3der/workshop-inline-v1.html` ([mcp/claude-view.js](../mcp/claude-view.js)) is `index.html` as it is, with three things put at the top of `<head>`:

1. `<base href>` pointing at an immutable copy of this repository on jsDelivr, `https://cdn.jsdelivr.net/gh/Pengeszikra/spi3der@<commit>/`, the commit the server runs (`buildInfo.gitHash`). Engine modules, models and icons load from there exactly as from Cloud Run. `SPI3DER_ASSET_BASE` overrides it (for a fork, an unpushed checkout, or tests). Where the commit cannot be found (an installed copy without `.git` and without `mcp/build-sha.txt`), it falls back to `@main`, which can drift from the running server.
2. `window.__SPI3DER_HOST__='mcp-app'` and the build info (the page has no `/api/version` beside it).
3. The bridge shell: the same MCP Apps logic as the ChatGPT widget (handshake, tool input/result, `workshop_publish`, `workshop_poll`, `workshop_reject`, diagnostics), but it talks to the native editor through `window.postMessage` in the same window instead of a child frame.

In `index.html`, `WORKSHOP_HOST` makes the existing workshop hooks use the same window as their peer and take the `session_id` from the shell's `apply_scene` message. No UI was added or changed; the view opens in the editor's existing Zen mode, as the ChatGPT workshop does.

The resource declares `resourceDomains`, `connectDomains` and `baseUriDomains` for the asset origin (plus Google Fonts) and no `frameDomains`.

The view is chosen by the server, not by the host:

| transport | view |
|---|---|
| `bin/spi3der-mcp.mjs` (stdio, the Claude plugin) | inline (`SPI3DER_VIEW=iframe` for the old one) |
| `https://spi3der.cloud.run/mcp?view=inline` (or `?host=claude`) | inline |
| `https://spi3der.cloud.run/mcp` | the ChatGPT iframe widget, unchanged |

In the inline view, the four tools only the view calls carry `_meta.ui.visibility: ["app"]`, and every tool has a `title` (MCP `title` and `annotations.title`).

## Use it

- **Claude Code / Cowork / Claude Desktop (local):** `/plugin install spi3der --marketplace Pengeszikra/spi3der`, or add the repository as a marketplace and install from there.
- **claude.ai on the web and mobile** cannot run a local server. Add a custom connector with `https://spi3der.cloud.run/mcp?view=inline` (needs the change deployed to Cloud Run).
- Plain stdio for any MCP host: `node bin/spi3der-mcp.mjs`.

## Tests

`npm run test:claude-view` runs the stdio server, serves the view on its own origin under a CSP built from its declaration (no frames, no workers, no WebAssembly), embeds it in a mock MCP Apps host and checks: the handshake, the scene rendered by the native editor, the scene published to the session, a queued `workshop_edit` applied and acknowledged, and keyboard input reaching the editor.

## Not yet verified in Claude

- Claude's real sandbox CSP: whether it allows jsDelivr as declared, module scripts from it, workers (blob:) and WebAssembly. The editor falls back to JavaScript picking without WebAssembly and to main-thread picking without workers.
- The exact host behaviour around size, display modes and keyboard focus.
- Directory submission (screenshots, public docs) has not been prepared.
