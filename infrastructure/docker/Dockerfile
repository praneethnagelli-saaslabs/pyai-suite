# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json turbo.json ./
COPY packages ./packages
COPY products ./products
COPY apps/api ./apps/api
COPY apps/web ./apps/web
COPY apps/worker ./apps/worker
COPY tools ./tools
RUN pnpm install --frozen-lockfile=false

FROM deps AS api
WORKDIR /app
ENV NODE_ENV=production
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@pyai/api", "start"]

FROM deps AS worker
WORKDIR /app
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@pyai/worker", "start"]

FROM deps AS web-build
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @pyai/web build

FROM nginx:1.27-alpine AS web
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
COPY infrastructure/docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
