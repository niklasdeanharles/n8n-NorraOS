# Norra auf dem eigenen Server

Die App ist eine gewoehnliche Next.js-Anwendung mit Node-Laufzeit. Nichts
darin ist an Vercel gebunden: kein Edge-Runtime, keine Vercel-SDKs, keine
Vercel-spezifische Konfiguration. Sie laeuft ueberall, wo ein Node-Prozess
laufen darf — also auch auf dem VPS, auf dem n8n schon steht.

Drei Gruende, warum das nicht bloss die billigere Variante ist:

1. **Kein Zeitlimit pro Aufruf.** Der Telefonpfad gibt sich selbst zwoelf
   Sekunden fuer eine Antwort. Auf einer Plattform mit hartem Funktionslimit
   ist das eine Rechnung, die knapp aufgeht; hier ist es keine.
2. **n8n liegt nebenan.** Jeder Turn geht heute ueber das oeffentliche Netz und
   einen TLS-Handshake. Im selben Docker-Netzwerk wird daraus ein Aufruf ueber
   `http://n8n:5678`.
3. **Kein Kaltstart.** Ein Container, der laeuft, laeuft. Twilio wartet keine
   fuenfzig Sekunden auf einen aufwachenden Dienst — es legt auf.

## Was du brauchst

Docker und Docker Compose auf dem VPS (n8n bringt beides schon mit), einen
A-Record auf den Rechner, und den Reverse Proxy, der dort ohnehin schon TLS
fuer n8n macht.

## Einrichten

```bash
git clone https://github.com/niklasdeanharles/n8n-NorraOS.git
cd n8n-NorraOS/norra/deploy
cp norra.env.example norra.env
$EDITOR norra.env            # Werte aus SETUP.md Schritt 1
docker compose up -d --build
```

Der Build braucht ungefaehr 1,5 GB Arbeitsspeicher. Auf einem kleinen VPS, auf
dem n8n schon laeuft, ist das knapp — dann vorher Swap anlegen:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
```

## Reverse Proxy

Der Container horcht auf `127.0.0.1:3000`, nicht nach aussen. Nach aussen geht
er ueber den Proxy, der schon da ist. Ein Block wie in `Caddyfile.example`, und
bei nginx gehoert dazu:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Die Antwort des Agenten wird gestreamt. Ohne diese beiden Zeilen sammelt
    # nginx sie ein und gibt sie am Stueck weiter: im Chat stuende sekundenlang
    # nichts und dann alles.
    proxy_buffering off;
    proxy_cache off;
}
```

Bei Traefik ist es eine Label-Zeile am Dienst; gepuffert wird dort per Vorgabe
nicht.

## Aktualisieren

```bash
cd n8n-NorraOS && git pull
cd norra/deploy && docker compose up -d --build
```

Es gibt bewusst keinen Webhook, der das bei jedem Push selbst tut. Ein Deploy,
der nachts niemanden fragt, ist derselbe Gedanke, aus dem der n8n-Deploy keine
Workflows scharf schaltet.

## Was `NEXT_PUBLIC_*` besonders macht

Diese beiden Werte werden beim **Bauen** in das JavaScript geschrieben, das
jeder Besucher laedt — nicht beim Start gelesen. Wer sie in `norra.env` aendert,
muss neu bauen (`--build`), sonst redet die App weiter mit dem alten Projekt.
Deshalb stehen sie im Compose zusaetzlich unter `build.args`.
