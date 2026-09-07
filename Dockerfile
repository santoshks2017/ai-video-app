# Cloud Run image for @ava/api. This is the API's Dockerfile; it lives at the
# repo root so `gcloud run deploy --source .` finds it with the monorepo as the
# build context (the API imports @ava/shared from packages/shared).
# The scraper job has its own image at jobs/scraper/Dockerfile.

FROM node:22-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci
RUN npm run build --workspace @ava/shared \
 && npm run build --workspace @ava/api

FROM node:22-slim AS runtime
ENV NODE_ENV=production
# ffmpeg: stitch multi-run generations into one final MP4.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
EXPOSE 8080
CMD ["node", "apps/api/dist/server.js"]
