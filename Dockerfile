# Playwright base image includes browser deps for Chromium
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY automation.mjs server.mjs dino-usecase.mjs strong-usecase.mjs login-dino.js login-strong.js ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.mjs"]
