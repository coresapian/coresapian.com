# ============================================================================
# CORESAPIAN — all-in-one image: built client (dist/public) + Hono/tRPC API +
# authoritative WS game gateway (/ws) on PORT (default 3000).
#
# Runtime environment (required):
#   DATABASE_URL   mysql://user:pass@host:port/db   (Drizzle/mysql2 character store)
# Optional:
#   PORT           default 3000
#   BUILD_VERSION  surfaced by GET /api/status (default "dev")
#
# All backend deps (hono, @hono/*, @trpc/server, superjson, tsx) are declared
# in package.json — npm ci installs the complete pinned tree.
# ============================================================================

# ---------------------------------------------------------------------------
# Stage 1: build the client bundle
# ---------------------------------------------------------------------------
FROM node:20 AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: production runtime
# ---------------------------------------------------------------------------
FROM node:20 AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# tsconfig path aliases (@db/*, @contracts/*) are resolved by tsx.
COPY tsconfig.json ./
COPY api ./api
COPY contracts ./contracts
COPY db ./db
COPY --from=build /app/dist/public ./dist/public

EXPOSE 3000

# Liveness: the status endpoint the site widgets poll.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "api/boot.ts"]
