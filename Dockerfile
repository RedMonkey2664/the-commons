# The Commons — the whole game in one image.
#
# UNVERIFIED: Docker is not installed on the machine this was written on, so
# this file has never been built. Everything it does IS tested by other means —
# tools/phase7b_single_origin.mjs runs the same build and the same start command
# and plays two browsers against the result — but the image build itself is not.
# Treat a first `docker build` as the test.
#
# The image contains BOTH halves: the client is built here and the server serves
# it, so a deployment is one process on one URL. That is not a packaging
# convenience — it is what makes the deploy work at all on a free tier. A
# separately hosted client is never same-origin with the game server, so it
# needs a server address configured into it and the server needs a CORS
# allowlist naming it back. Same-origin needs neither: the client derives
# wss:// from the page it was served by. See README "Deploying".

# --- build the client ------------------------------------------------------
# A separate stage because building needs vite and typescript, and shipping
# those to production would roughly double the image for no runtime benefit.
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY client/package.json ./client/
COPY server/package.json ./server/

# No --include-workspace-root: the root's only devDependency is playwright,
# which downloads a browser bundle on install and is used by tests, not builds.
RUN npm ci --workspace shared --workspace client

# The client build reaches outside client/: `@commons/shared` through a Vite
# alias, and assets/ as its publicDir (09 puts maps at the repo root so the
# server can read the same map JSON for authoritative collision).
COPY shared/ ./shared/
COPY client/ ./client/
COPY assets/ ./assets/

RUN npm run build --workspace client

# --- run the server, serving that client -----------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY client/package.json ./client/
COPY server/package.json ./server/

# tsx is a production dependency of the server, not a dev one: there is no build
# step, and tsx is what runs the TypeScript directly, resolving the path mapping
# to shared/ at runtime — the same thing `npm start` does locally. So this
# survives --omit=dev, and a host that prunes dev dependencies after building
# still has a runtime.
RUN npm ci --workspace shared --workspace server

COPY shared/ ./shared/
COPY server/ ./server/
# Read by the SERVER for authoritative collision — these are not the copies the
# browser fetches. Those are inside client/dist, baked in by the builder stage.
COPY assets/maps/ ./assets/maps/
COPY --from=builder /app/client/dist ./client/dist

ENV NODE_ENV=production
# Hosts override PORT; this is only a sensible default for a bare `docker run`.
ENV PORT=2567
EXPOSE 2567

# Node handles SIGTERM itself here (it is PID 1), and the server installs a
# handler that flushes the store before exiting.
CMD ["npm", "start", "--workspace", "server"]
