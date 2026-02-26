FROM node:20-slim AS build
WORKDIR /app

# On définit l'argument de build pour l'URL API
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Étape finale
FROM node:20-slim
WORKDIR /app
# On récupère le build
COPY --from=build /app/package*.json ./
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000
# Commande pour lancer Next.js
CMD ["npm", "start"]
