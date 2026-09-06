FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/control-plane-contract/package.json packages/control-plane-contract/package.json
COPY packages/control-plane-postgres/package.json packages/control-plane-postgres/package.json
COPY apps/ledger-api/package.json apps/ledger-api/package.json
RUN pnpm install --frozen-lockfile
COPY packages/control-plane-contract packages/control-plane-contract
COPY packages/control-plane-postgres packages/control-plane-postgres
COPY apps/ledger-api apps/ledger-api
RUN pnpm --filter @alicorn-cloud/control-plane-contract build && pnpm --filter @alicorn-cloud/control-plane-postgres build && pnpm --filter @alicorn-cloud/ledger-api build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8082
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/control-plane-contract/package.json packages/control-plane-contract/package.json
COPY packages/control-plane-postgres/package.json packages/control-plane-postgres/package.json
COPY apps/ledger-api/package.json apps/ledger-api/package.json
COPY --from=build /app/packages/control-plane-contract/dist packages/control-plane-contract/dist
COPY --from=build /app/packages/control-plane-postgres/dist packages/control-plane-postgres/dist
COPY --from=build /app/apps/ledger-api/dist apps/ledger-api/dist
RUN pnpm install --prod --frozen-lockfile --filter @alicorn-cloud/ledger-api...
USER node
EXPOSE 8082
CMD ["node", "apps/ledger-api/dist/index.js"]
