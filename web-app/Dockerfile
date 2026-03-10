# =============================================================================
# Multi-stage build for UMZH Connect Sandbox Web App
# =============================================================================

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# --- Stage 2: Serve with nginx ---
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy env config script (runtime env vars)
COPY env.sh /docker-entrypoint.d/40-env.sh
RUN chmod +x /docker-entrypoint.d/40-env.sh

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
