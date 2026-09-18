# syntax=docker/dockerfile:1

# Norra-Konsole und Widget als eigenes Image -- fuer den Hostinger-VPS, auf dem
# schon n8n laeuft. Dieselbe App, die auf Vercel laeuft; nichts daran ist
# Vercel-spezifisch.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* wird beim *Bauen* in das JavaScript geschrieben, das jeder
# Besucher laedt -- nicht beim Start. Wer sie nur als Laufzeit-Variable setzt,
# bekommt eine App, die gegen `undefined` redet. Oeffentlich sind beide
# ohnehin: der anon-Key haengt an RLS.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1

RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" \
  || (echo "NEXT_PUBLIC_SUPABASE_URL fehlt als --build-arg." >&2 && exit 1)
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs norra

# `output: 'standalone'` legt Server und Abhaengigkeiten hier ab; die statischen
# Dateien liegen daneben und muessen mitkopiert werden.
COPY --from=builder --chown=norra:nodejs /app/.next/standalone ./
COPY --from=builder --chown=norra:nodejs /app/.next/static ./.next/static

USER norra
EXPOSE 3000
CMD ["node", "server.js"]
