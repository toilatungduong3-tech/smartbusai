# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app

# Cài wget để healthcheck
RUN apk add --no-cache wget

# Copy dependencies từ builder
COPY --from=builder /app/node_modules ./node_modules

# Copy source code
COPY . .

# Không copy .env (dùng biến môi trường từ docker-compose)
RUN rm -f .env

EXPOSE 2704

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:2704/api/auth/test || exit 1

CMD ["npm", "start"]
