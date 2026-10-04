FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY package.json ./
COPY --from=builder /app/dist ./dist
COPY example-repo ./example-repo
USER node
EXPOSE 3001
CMD ["node", "dist/server/index.js"]
