# spi3der collaborative workshop — MCP v8 (26.11.22.001)

This is a browser-native, ChatGPT-embedded collaboration **MVP**. The real spi3der `index.html` is the one and only editor. This protocol adds scene synchronization, not a new panel, toolbar or keyboard map.

## Data flow

1. Agent invokes `open_workshop({steps})`. MCP validates and relays the operations, creates a cryptographically random `session_id`, and sends a widget with `baseScene` + steps.
2. The widget executes those steps with bundled `WorkshopModel`, packs a `#scene` fragment, and embeds `index.html?workshop=1#session=...&scene=...`. Geometry still runs in the browser.
3. The **native** editor imports, emits `native_scene_loaded` and `native_scene_changed` carrying an exported `3draft-scene`. Native edits call existing `rebuild()`; its new hook debounces and publishes snapshots without changing the UI or key handling.
4. The parent widget calls `workshop_publish({session_id,revision,scene})` and receives the new revision.
5. Agent calls `workshop_state({session_id,include_scene?:boolean})` to inspect the latest real scene, object names, bounds, and revision. `include_scene:true` obtains the full native export when necessary.
6. Agent calls `workshop_edit({session_id,revision,steps})`. An accepted call means **queued**, not executed.
7. The still-open widget polls `workshop_poll`, replays the steps in a browser-side `WorkshopModel` initialized from the last native scene, and posts `apply_scene` to the native iframe. The native editor imports it through its existing `loadScene` path and publishes the result with the `batch_id`. The server commits the new revision and reports `last_edit.status=applied`. Errors are reported via `workshop_reject`.
8. Agent rechecks `workshop_state` before giving another geometry command. Revisions are optimistic compare-and-swap; stale edits are rejected instead of silently overwriting a human.

## Large model transfer

For tool requests whose declarative command history exceeds 32 KiB, `open_workshop` returns only a compressed `workshop_token` in its structured payload, not duplicate raw steps. The widget unpacks the history locally using `DecompressionStream('deflate-raw')` before executing the same `WorkshopModel`. Small calls still use direct steps for compatibility. This avoids unnecessarily large MCP responses without adding a UI or moving modelling to the server. `tests/mcp-app.mjs` and `tests/mcp-widget-bridge.mjs` exercise both paths.

## Session and security

- `session_id` is a 160-bit bearer capability, and appears only in tool payloads and URL fragments (not HTTP query URLs). Treat it like a secret; do not paste it into public logs or issues.
- The widget accepts native event messages only when `event.source === frame.contentWindow`, `event.origin === APP_ORIGIN` and `source === 'spi3der-native'`. The native editor accepts `apply_scene` only from its actual parent and with the matching session capability.
- The backend keeps up to 64 sessions for 2 hours since last access. Scenes up to 600,000 bytes and 3,000 objects, with up to 100 steps per agent edit. Only one agent edit can be pending per session.
- This in-memory store is for a **single Cloud Run instance**. Deploy with `--max-instances 1` while testing. It is not durable across restart/redeploy, and multi-instance deployment requires Redis/Firestore/GCS or equivalent shared state and conflict strategy.
- There is no autonomous remote agent. The LLM is invoked only by an ordinary chat turn; the widget polls for queued edits while it is running. Closing the widget stops automatic application of pending steps.
- Simultaneous human/AI writes are guarded by revision checks, but concurrent pointer editing during an incoming agent batch needs further UX/rebase handling. Do not claim production multi-user conflict-free editing.
- The native scene export contains actual geometry and scene metadata. If `workshop_publish` fails, the widget displays an error; the agent must not assume the snapshot was saved.

## Acceptance test

1. Deploy a build with version `26.11.22.001` and the matching Git SHA. Reconnect the custom ChatGPT plugin so it reads the v8 MCP App resource.
2. Ask `open_workshop` to build a cube. Inspect the actual native editor and its native version stamp. Do not count MCP `response_ready` as proof of rendering.
3. Call `workshop_state` using the returned `session_id`. Verify `ready=true` and the real cube's bounds.
4. In the embedded editor, add/transform an object with its **existing** keyboard and pointer controls. Call `workshop_state` again: object count/positions and revision should change.
5. Call `workshop_edit` with the just-read revision and an `add_box` or `place_on` command. Check the object appears in the **same** iframe. Recheck `workshop_state` and `last_edit.status=applied`.
6. Submit a stale revision and verify conflict rejection. Try an invalid object name; verify failure is surfaced, no silent success, and the session remains editable.
7. For the eight-legged spider demo, identify the tabletop object's top Y and bounds from `workshop_state` first, then place eight low-poly legs and a body with absolute geometry calculated from the real scene. Do not guess which object is the table.

## Local automated checks

```sh
npm run test:mcp-app
node tests/mcp-widget-bridge.mjs
node tests/workshop-session.mjs
node tests/cloud-run.mjs
```

These cover the MCP protocol and simulated parent/native message bridge, not the real ChatGPT host's keyboard focus or Cloud Run multi-instance persistence. Those still require an actual embedded end-to-end test.
