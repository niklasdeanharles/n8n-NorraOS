# Setup

Was die Umgebung kennen muss, bevor diese Skill etwas anlegen kann — und was
sie ausdrücklich **nicht** kennen darf.

## Die zwei Pflichtwerte

```bash
export SUPABASE_URL=https://<projekt>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...        # Supabase -> Project Settings -> API
```

Der Service-Role-Key umgeht RLS vollständig. Das ist hier notwendig — die Skill
legt Zeilen für eine Organisation an, ohne als ein Mitglied dieser Organisation
angemeldet zu sein — und gleichzeitig der Grund, warum die
`organization_id` in Phase 1 **einmal** festgestellt und danach in jede Zeile
geschrieben wird. Im Service-Role-Pfad ist RLS keine Verteidigungslinie.

## Für den Livegang zusätzlich

```bash
export N8N_BASE_URL=https://<instanz>
export N8N_API_KEY=...                      # n8n -> Settings -> API
```

Nur nötig, um den Zustand der Instanz zu lesen (`preflight.mjs`) oder die
Wissensbasis über den `kb-ingest`-Webhook zu füllen. Zum Anlegen eines Agenten
als Entwurf braucht es sie nicht.

## Was hier nie steht

`N8N_WEBHOOK_SECRET`, der Anthropic-Key und das Twilio-Token gehören **nicht**
in diese Skill und nicht in dieses Repository. Sie leben in Vercel und in den
n8n-Credentials. Die Skill sieht sie nie, braucht sie nie und darf sie nie
erfragen.

Fehlt einer davon auf der Instanz, meldet `preflight.mjs` das beim Namen. Das
ist die richtige Stelle dafür: ein Mensch legt die Credential an, nicht ein
Agent.

## Rauchtest, kostenfrei

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$SUPABASE_URL/rest/v1/organizations?select=id&limit=1"
```

`200` heißt: erreichbar und berechtigt. `401` heißt: der Key stimmt nicht.
`404` heißt: die URL zeigt woandershin.

## Die Organisation feststellen

Jede Zeile braucht sie, und sie wird genau einmal ermittelt:

```bash
curl -sS -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     "$SUPABASE_URL/rest/v1/organizations?select=id,name"
```

Gibt es mehr als eine, **fragen** — nicht die erste nehmen. Die falsche
Organisation zu treffen heißt, einen Agenten in den Mandanten eines fremden
Kunden zu schreiben.
