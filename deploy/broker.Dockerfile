FROM node:22.17.0-alpine

WORKDIR /app
COPY broker/package.json broker/package-lock.json ./
COPY broker/vendor ./vendor
RUN npm ci --omit=dev

COPY config/fx-v3-public-testnet.json /app/config/fx-v3-public-testnet.json

USER node
CMD ["node", "node_modules/@versus/network/scripts/fx-phase7-broker.js"]
