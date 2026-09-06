# Cloud Run image for @ava/api. Built from the repo root (monorepo context).
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY apps/api/package.json apps/api/tsconfig.json apps/api/
RUN npm install --workspaces --include-workspace-root
COPY packages/shared/src packages/shared/src
COPY apps/api/src apps/api/src
RUN npm run build --workspace @ava/shared && npm run build --workspace @ava/api

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
EXPOSE 8080
CMD ["node", "apps/api/dist/server.js"]
