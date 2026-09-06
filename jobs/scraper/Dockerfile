# Cloud Run job image for @ava/scraper. Built from the repo root.
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* tsconfig.base.json ./
COPY jobs/scraper/package.json jobs/scraper/tsconfig.json jobs/scraper/
RUN npm install --workspace @ava/scraper --include-workspace-root
COPY jobs/scraper/src jobs/scraper/src
COPY jobs/scraper/models.json jobs/scraper/models.json
RUN npm run build --workspace @ava/scraper

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/jobs/scraper/package.json ./jobs/scraper/package.json
COPY --from=build /repo/jobs/scraper/models.json ./jobs/scraper/models.json
COPY --from=build /repo/jobs/scraper/dist ./jobs/scraper/dist
CMD ["node", "jobs/scraper/dist/index.js"]
