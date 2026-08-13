# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

# Install from package manifests only so source edits do not bust the pnpm cache.
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/control/package.json packages/control/
COPY packages/integrations/package.json packages/integrations/
COPY products/calliq/package.json products/calliq/
COPY products/scrib/package.json products/scrib/
COPY products/brief/package.json products/brief/
COPY products/simulator/package.json products/simulator/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY tools/cli/package.json tools/cli/
COPY tools/mcp/package.json tools/mcp/
RUN --mount=type=cache,id=pyai-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile=false --store-dir=/pnpm/store

FROM deps AS src
COPY tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY products ./products
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY apps/worker ./apps/worker
COPY tools ./tools

FROM src AS api
WORKDIR /app
ENV NODE_ENV=production
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@pyai/api", "start"]

FROM src AS worker
WORKDIR /app
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@pyai/worker", "start"]

FROM src AS web-build
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @pyai/web build

FROM nginx:1.27-alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
