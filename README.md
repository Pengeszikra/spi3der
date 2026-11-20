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

The package name is `spi3der`, with a CLI that hosts the app locally. The package is configured for `npm pack` / `npm publish` but is **not automatically published**. The source project has no license declaration; the npm metadata intentionally uses `UNLICENSED` until the author decides on a license.

## Compatibility

- `?scene=globe`, `?scene=deepsky` or `?scene=game:lark` explicitly loads a scene.
- `?autovr` explicitly enables the previous automatic headset VR offer.
- Desktop starts empty; use **Enter XR** to enter VR manually.

Original source: https://github.com/Pengeszikra/five-percent
