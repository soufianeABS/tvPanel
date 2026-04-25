# Playwright base image includes browser deps for Chromium
FROM mcr.microsoft.com/playwright:v1.53.0-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY automation.mjs server.mjs login.js ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]
