# IRON Habit Tracker — static export served by `serve`
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# NEXT_PUBLIC_* vars are baked into the static bundle at build time.
# Railway exposes service variables as Docker build args automatically.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN npm i -g serve@14.2.5
COPY --from=build /app/out ./out
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "serve out -l tcp://0.0.0.0:${PORT}"]
