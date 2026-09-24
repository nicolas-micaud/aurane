# World server image: one process per season. Built from the monorepo root:
#   docker build -f apps/world/Dockerfile -t aurane-world:<sha> .
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/sim/package.json packages/sim/
COPY tools/season-sim/package.json tools/season-sim/
COPY apps/world/package.json apps/world/
RUN npm ci --ignore-scripts
COPY packages ./packages
COPY tools ./tools
COPY apps/world ./apps/world
RUN npx tsc -b apps/world

FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 SNAPSHOT_DIR=/data
WORKDIR /app
COPY --from=build /src/package.json /src/package-lock.json ./
COPY --from=build /src/packages/protocol/package.json packages/protocol/
COPY --from=build /src/packages/sim/package.json packages/sim/
COPY --from=build /src/tools/season-sim/package.json tools/season-sim/
COPY --from=build /src/apps/world/package.json apps/world/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /src/packages/protocol/dist packages/protocol/dist
COPY --from=build /src/packages/sim/dist packages/sim/dist
COPY --from=build /src/apps/world/dist apps/world/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "apps/world/dist/main.js"]
