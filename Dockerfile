# Production image: builds the web app and server, then runs them with only
# runtime dependencies. The database and photos live in /data — mount a
# persistent volume there (on Railway: add a Volume with mount path /data).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries, but `npm ci` can't see its "gypfile": false in the
# lockfile and would try to compile it from source; skipping install scripts avoids that.
RUN npm ci --ignore-scripts && npm rebuild esbuild
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DEFAULT_DATA_DIR=/data \
    PORT=3001
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Runs as root because hosted volumes (e.g. Railway) are mounted root-owned.
# No VOLUME instruction: Railway rejects it; attach a volume at /data instead
# (or `docker run -v card-data:/data …`).
RUN mkdir -p /data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3001) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/server.js"]
