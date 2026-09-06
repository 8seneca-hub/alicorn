FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/control-plane-contract/package.json packages/control-plane-contract/package.json
COPY packages/control-plane-postgres/package.json packages/control-plane-postgres/package.json
COPY apps/control-api/package.json apps/control-api/package.json
RUN pnpm install --frozen-lockfile
COPY packages/control-plane-contract packages/control-plane-contract
COPY packages/control-plane-postgres packages/control-plane-postgres
COPY apps/control-api apps/control-api
RUN pnpm --filter @alicorn-cloud/control-plane-contract build && pnpm --filter @alicorn-cloud/control-plane-postgres build && pnpm --filter @alicorn-cloud/control-api build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8081
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/control-plane-contract/package.json packages/control-plane-contract/package.json
COPY packages/control-plane-postgres/package.json packages/control-plane-postgres/package.json
COPY apps/control-api/package.json apps/control-api/package.json
COPY --from=build /app/packages/control-plane-contract/dist packages/control-plane-contract/dist
COPY --from=build /app/packages/control-plane-postgres/dist packages/control-plane-postgres/dist
COPY --from=build /app/apps/control-api/dist apps/control-api/dist
RUN pnpm install --prod --frozen-lockfile --filter @alicorn-cloud/control-api...
USER node
EXPOSE 8081
CMD ["node", "apps/control-api/dist/index.js"]
