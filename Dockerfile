# spi3der Cloud Run: serve the browser application and Streamable HTTP MCP endpoint.
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "bin/cloud-run.mjs"]
