FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# server/ only uses Node built-ins, so the runtime image needs no node_modules
FROM node:24-slim
WORKDIR /app
COPY --from=build /app/dist dist
COPY server server
COPY package.json .
ENV PORT=8080 KTV_CONFIG=/data/config.json
VOLUME /data
CMD ["node", "server/serve.ts"]
