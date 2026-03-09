###############################################################################
# Performance Platform — API Service Docker Image
###############################################################################
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

FROM node:20-alpine
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -D appuser
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY src/ ./src/
COPY migrations/ ./migrations/
COPY package.json ./

RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 8080
CMD ["node", "src/server.js"]
