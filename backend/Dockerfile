# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts

# ---- run ----
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts
COPY package*.json ./
EXPOSE 8080
CMD ["node", "src/server.js"]
