FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
ENV NODE_ENV=production
# Dados (SQLite + chaves das notificações) ficam em /app/data:
# monte aqui um disco persistente (volume) no provedor.
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["npm", "start"]
