# dsh-tab-watchdog

A persistent plugin for **DeepSeek Harness Web**: when one of your workspaces/sessions finishes a work round, errors out, or needs attention, the tab title blinks a `🟢`/`🟡` badge.

This is the "bundle" version (persistent, installable, shareable) of the **Tab Watchdog** dynamic plugin originally developed in Creator mode. Unlike a dynamic plugin it **survives `dsh` restarts and browser reloads (F5)**.

## How it works (architecture)

Two halves in a single npm package, like the official plugins:

- **Host half** (`index.js`) — profile composition row (`cordis.patch.yml` + `dsh.bundle.patch`). It makes the package a Loader entry: that row is what pulls the browser half into the boot manifest. No business logic here.
- **Browser half** (`lib/client.js`, served via `dsh.client` + the `./client` export) — a bundle in the `window.__ModuleLoader__.load({ id, factory })` format. It subscribes to the **Host events forwarded to the browser** and handles everything (state, watermark, blink). No UI is added to the harness.

### Triggers (what makes it blink)

The browser only receives the events on the `dsh-api-remotes` allowlist. The watchdog uses:

| Event | Level | Label |
|---|---|---|
| `api-session/status(sessionId, running=false)` | 🟢 green | "Finished a work round" |
| `api-session/error(sessionId, message)` | 🟡 yellow | "Error…" |
| `user-questions/request(...)` (passive) | 🟡 yellow | "Asking for a response" |
| `approval/request(...)` (passive) | 🟡 yellow | "Requires approval" |

The `user-questions/request` and `approval/request` observers are **passive**: they always call `next()` so they never interfere with the official question/approval UI. If another handler consumes a request before the watchdog sees it, the yellow may not show; the green/error `emit` events are always delivered to **every** listener in parallel, so they are guaranteed.

Note: `workflow/end`, `agent/status`, and `goal/changed` are **not** forwarded to the browser in this version's allowlist; observing them would require host-side aggregation over a custom channel (out of scope by design).

### Watermark model

- Events only arrive **while the page is open** (even on another browser tab — that is exactly the intended use case).
- New events stay "pending" until you **come back** to the page.
- While the page is not focused and at least one item is pending, the title alternates between `🟢n 🟡m · <title>` and `<title>`.
- An event that arrives **while you are focused** is marked read immediately (no leftover blinking).
- When a session **restarts** (`running=true`), its pending entries are removed.
- An error on a session "freezes" its entry in yellow: a later `running=false` does not downgrade it to green.

## Installation (local `web` profile)

From the plugin checkout:

```sh
# from the directory that contains dsh-tab-watchdog/
npx @deepseek-ai/dsh@latest plugin --profile web add ./dsh-tab-watchdog
```

Then restart `dsh web`. The browser half activates on the next reload/startup. The added row is the `tab-watchdog` entry in the profile's `cordis.yml`.

Removal:

```sh
npx @deepseek-ai/dsh@latest plugin --profile web remove dsh-tab-watchdog
```

> `dsh plugin` forwards to pnpm inside the profile. If pnpm is not installed: `corepack enable` or `npm i -g pnpm`.

## Development

The browser half source is `src/client.js` (a CJS fragment living inside the loader factory). The `lib/client.js` artifact is **committed** (no build step at git-install time).

```sh
npm run build   # regenerates lib/client.js from src/client.js
npm test        # verify (bundle structure) + smoke (blink/watermark logic)
```

No `prepare`/monorepo toolchain needed: out-of-tree plugins cannot use the internal `clientBundle` preset, so the loader format is reproduced by hand (`scripts/build.mjs`).

## Sharing with the community

The package declares `dsh.bundle.patch`, so it installs as a profile bundle. Because `lib/client.js` and `index.js` are committed artifacts, a **git install works without `prepare`**:

```sh
npx @deepseek-ai/dsh@latest plugin --profile web add github:andreagosto/dsh-tab-watchdog
```

For discoverability, the GitHub repository carries the **`dsh-plugin`** topic (see the official deepseek-harness README, "Community and support"). Alternatively: `npm publish`, then `dsh plugin --profile web add dsh-tab-watchdog`.

## Notes and limitations

- Tested against runtime `@deepseek-ai/dsh` **0.1.2-rc.1** (mind the "breaking changes" notice on rc prereleases).
- The browser half is hand-written against the APIs observed in the installed bundles; the structure is validated by `npm test`, but verify it live in your own profile.
- No settings namespace: the plugin does not appear in Settings → Plugins. To disable it use `dsh plugin remove` (or set `disabled: true` on the row in the profile patch).

## License

MIT
