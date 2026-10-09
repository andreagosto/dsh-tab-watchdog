# AGENTS.md

## Progetto
dsh-tab-watchdog — plugin per DeepSeek Harness Web: fa lampeggiare il titolo della scheda con
un badge quando un workspace finisce un giro (verde) o richiede attenzione (errore, domanda,
approvazione). Plugin "a due metà" (host + browser), persistente.

## Stack
- Node.js, ESM (`"type": "module"`), plugin Cordis (`cordis.patch.yml`)
- Export: `.` → `index.js`, `./client` → `lib/client.js`

## Comandi
- `npm run build` — build
- `npm run verify` / `npm run smoke` — verifiche
- `npm test` — verify + smoke

## Convenzioni
- Mantieni la compatibilità con l'API plugin di dsh (bundle/patch + client web).
