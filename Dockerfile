FROM node:24-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM deps AS build
WORKDIR /app

COPY tsconfig.base.json ./
COPY apps apps
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV SERVER_PORT=8080
ENV WEB_ORIGIN=http://localhost:8080
ENV VITE_API_BASE_URL=http://localhost:8080
ENV PERSISTENCE_ADAPTER=sqlite
ENV POSTGRES_SCHEMA=public
ENV LOCAL_MODEL_PROVIDER=ollama
ENV LOCAL_MODEL_NAME=student-local-1p5b-toolbench-lora-v10-light:latest
ENV LOCAL_MODEL_BASE_URL=http://host.docker.internal:11435
ENV LOCAL_MODEL_OBSERVER_ENABLED=false

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev

COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist

RUN mkdir -p \
  storage/history \
  storage/benchmarks \
  storage/knowledge \
  storage/datasets \
  storage/cache \
  storage/fixtures \
  storage/learning

EXPOSE 8080

CMD ["npm", "run", "start", "-w", "@hydria-arena/server"]
