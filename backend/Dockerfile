FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend/server.js ./
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/migrations ./migrations
USER node
EXPOSE 3001
CMD ["node", "server.js"]
