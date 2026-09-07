# dsh-tab-watchdog

Plugin persistente per **DeepSeek Harness Web**: quando uno dei tuoi workspace/sessioni finisce un giro di lavoro, va in errore, o richiede attenzione, il titolo del tab lampeggia con un badge `🟢`/`🟡`.

È la versione "bundle" (persistente, installabile, condivisibile) del plugin dinamico **Tab Watchdog** sviluppato in Creator mode (vedi `../conversazione-export.md`). A differenza del plugin dinamico **sopravvive a riavvio di `dsh` e a F5** del browser.

## Come funziona (architettura)

Due metà in un solo pacchetto npm, come i plugin ufficiali:

- **Metà Host** (`index.js`) — riga di composizione del profilo (`cordis.patch.yml` + `dsh.bundle.patch`). Serve a rendere il pacchetto un entry del Loader: è grazie a questa riga che la metà Browser entra nel boot manifest. Qui non c'è logica di business.
- **Metà Browser** (`lib/client.js`, servita via `dsh.client` + export `./client`) — un bundle nel formato `window.__ModuleLoader__.load({ id, factory })`. Si iscrive agli **eventi host inoltrati al browser** e gestisce tutto (stato, watermark, lampeggio). Nessuna UI aggiunta all'harness.

### Trigger (cosa fa lampeggiare)

Il browser riceve solo gli eventi dell'allowlist di `dsh-api-remotes`. Il watchdog usa:

| Evento | Livello | Etichetta |
|---|---|---|
| `api-session/status(sessionId, running=false)` | 🟢 verde | "Ha finito il giro di lavoro" |
| `api-session/error(sessionId, message)` | 🟡 giallo | "Errore…" |
| `user-questions/request(...)` (passivo) | 🟡 giallo | "Chiede una risposta" |
| `approval/request(...)` (passivo) | 🟡 giallo | "Richiede approvazione" |

Gli osservatori su `user-questions/request` e `approval/request` sono **passivi**: chiamano sempre `next()` per non interferire con la UI ufficiale delle domande/approvazioni. Se una richiesta viene consumata da un altro handler prima del watchdog, il giallo potrebbe non comparire; il verde/errore (eventi `emit`) sono invece sempre garantiti perché `ctx.remote.$on` li distribuisce a **tutti** i listener in parallelo.

Nota: `workflow/end`, `agent/status` e `goal/changed` **non** vengono inoltrati al browser nell'allowlist di questa versione; per osservarli servirebbe l'aggregazione lato host con un canale custom (non incluso per scelta di semplicità).

### Modello a watermark

- Gli eventi arrivano solo **con la pagina aperta** (anche su un'altra scheda del browser: è proprio lo scenario d'uso).
- I nuovi eventi vengono considerati "pendenti" finché **torni** sulla pagina.
- Mentre la pagina non è focalizzata e c'è almeno un pendente, il titolo alterna `🟢n 🟡m · <titolo>` e `<titolo>`.
- Un evento che arriva **mentre sei focalizzato** viene segnato come letto subito (niente lampeggio residuo).
- Quando una sessione **riparte** (`running=true`) le sue segnalazioni pendenti vengono rimosse.
- Un errore su una sessione "congela" l'entry in giallo: il successivo `running=false` non la retrocede a verde.

## Installazione (profilo `web` locale)

Dal checkout del plugin:

```sh
# dalla cartella che contiene dsh-tab-watchdog/
npx @deepseek-ai/dsh@latest plugin --profile web add ./dsh-tab-watchdog
```

Poi riavvia `dsh web`. La metà browser entra al successivo F5/avvio. La riga aggiunta è l'entry `tab-watchdog` nel `cordis.yml` del profilo.

Rimozione:

```sh
npx @deepseek-ai/dsh@latest plugin --profile web remove dsh-tab-watchdog
```

> Il comando `dsh plugin` inoltra a pnpm nel profilo. Se pnpm non è installato (`corepack enable` o `npm i -g pnpm`).

## Sviluppo

Il sorgente della metà browser è `src/client.js` (fragment CJS che vive dentro la factory del loader). L'artefatto `lib/client.js` è **committato** (nessun build all'installazione da git).

```sh
npm run build   # rigenera lib/client.js da src/client.js
npm test        # verify (struttura bundle) + smoke (logica lampeggio/watermark)
```

Nessun `prepare`/toolchain del monorepo: i plugin esterni non possono usare il preset `clientBundle` interno, quindi il formato del loader viene riprodotto a mano (`scripts/build.mjs`).

## Condivisione con la community

Il pacchetto dichiara `dsh.bundle.patch`, quindi si installa come bundle di profilo. Poiché `lib/client.js` e `index.js` sono artefatti committati, un'installazione **da git funziona senza `prepare`**:

```sh
npx @deepseek-ai/dsh@latest plugin --profile web add github:tuo-user/dsh-tab-watchdog
```

Per la discoverability: crea un repo GitHub con il topic **`dsh-plugin`** (vedi README ufficiale deepseek-harness, sezione "Community and support"). In alternativa: `npm publish` e poi `dsh plugin --profile web add dsh-tab-watchdog`.

## Note e limiti

- Versione di riferimento testata: runtime `@deepseek-ai/dsh` **0.1.2-rc.1** (leggere l'avviso "breaking changes" dei prerelease rc).
- La metà browser è scritta a mano contro le API osservate nei bundle installati; la struttura è validata da `npm test` ma va verificata dal vivo nel tuo profilo.
- Nessun namespace di settings: il plugin non appare in Settings → Plugins. Per disattivarlo si usa `dsh plugin remove` (o `disabled: true` su una riga nel patch del profilo).

## Licenza

MIT
