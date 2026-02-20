# Build stage
FROM node:22.14.0-alpine AS builder

WORKDIR /app

# Add build arguments for environment variables needed during build
ARG OPENAI_API_KEY=dummy-key-for-build

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY next.config.ts ./
COPY postcss.config.mjs ./
COPY components.json ./
COPY eslint.config.mjs ./

# Copy source code
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY public ./public
COPY prisma ./prisma
COPY sse.ts .
COPY websocket.ts .

# Install dependencies
RUN npm ci

# Build Next.js with environment variable
ENV OPENAI_API_KEY=${OPENAI_API_KEY}
RUN npm run build

# Generate Prisma Client
RUN npx prisma generate

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy package files
COPY package*.json ./

# Copy prisma schema BEFORE npm install (for postinstall script)
COPY prisma ./prisma

# Install only production dependencies and run postinstall
RUN npm ci --only=production && npm cache clean --force

# Ensure Prisma Client is generated
RUN npx prisma generate

# Copy built application from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/generated ./generated

# Copy server files
COPY server.ts .
COPY websocket.ts .
COPY sse.ts .
COPY lib ./lib

# Expose port
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/sbin/dumb-init", "--"]

# Start application (with migrations via postinstall script in npm start)
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
