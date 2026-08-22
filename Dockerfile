# SmartBusAI — production Dockerfile (multi-stage build).
#
# Stage 1 installs dependencies (including devDependencies, since some
# projects need a build step here — this one doesn't, but keeping the
# stage separate still pays off: it's the layer Docker caches across
# rebuilds whenever only application code changes, not package.json).
# Stage 2 copies only production node_modules + application source into a
# clean, smaller final image — no devDependencies (jest/nodemon), no
# .git, no test files, no build cache.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Non-root user — the base image ships a pre-created `node` user/group,
# reused here rather than defining a new one.
COPY --from=deps /app/node_modules ./node_modules
COPY server ./server
COPY public ./public
COPY package.json ./

RUN chown -R node:node /app
USER node

EXPOSE 2704

# Container-level health check, backed by the real GET /api/health
# endpoint (Sprint 5) — reports unhealthy if the DB pool ping fails, not
# just "the Node process is alive".
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||2704)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
