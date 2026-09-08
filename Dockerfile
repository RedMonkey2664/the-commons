# The Commons — game server.
#
# UNVERIFIED: Docker is not installed on the machine this was written on, so
# this file has never been built. The server it runs IS tested (tools/
# phase7_deploy.mjs exercises the same start command, env vars and production
# client bundle over a real network), but the image build itself is not. Treat a
# first `docker build` as the test.
#
# Only the SERVER belongs in here. The client is a static bundle and goes to
# Vercel or any static host; see README "Deploying".

FROM node:22-alpine

WORKDIR /app

# The server imports @commons/shared through a tsconfig path, and workspaces
# resolve at the repo root — so the whole workspace comes along rather than just
# server/. Manifests first, so a code-only change does not reinstall deps.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY client/package.json ./client/
COPY server/package.json ./server/

# --omit=dev would drop tsx, which is what runs the server. There is no build
# step: tsx resolves the TypeScript path mapping to shared/ at runtime, which is
# the same thing `npm start` does locally.
RUN npm ci --workspace shared --workspace server --include-workspace-root

COPY shared/ ./shared/
COPY server/ ./server/
# Maps are read by the server for authoritative collision — not client assets.
COPY assets/maps/ ./assets/maps/

ENV NODE_ENV=production
# Hosts override PORT; this is only a sensible default for a bare `docker run`.
ENV PORT=2567
EXPOSE 2567

# Node handles SIGTERM itself here (it is PID 1), and the server installs a
# handler that flushes the store before exiting.
CMD ["npm", "start", "--workspace", "server"]
