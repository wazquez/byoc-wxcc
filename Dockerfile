# Multi-stage build for Google Cloud Run.
#
# Cloud Run runs a single container and injects the port to listen on via the
# PORT environment variable (defaults to 8080). The server reads process.env.PORT
# and binds 0.0.0.0 — see src/server.ts.

# ---- Build stage: compile TypeScript -> dist/ ----
FROM node:20-slim AS build
WORKDIR /app

# Install all deps (including dev) against the lockfile for a reproducible build.
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage: production deps + compiled output only ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Only production dependencies ship in the final image.
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# Cloud Run overrides this at deploy time; 8080 is its default contract.
ENV PORT=8080
EXPOSE 8080

# Run as the non-root user provided by the base image.
USER node

CMD ["node", "dist/server.js"]
