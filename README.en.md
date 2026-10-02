# Wallet HUD

Shows the signed-in account's DeepSeek wallet balance in the sidebar footer of the **DeepSeek Harness** Web UI.

[简体中文](README.md) | **English**

## Features

- **One seat**: a compact chip in the sidebar footer, next to Settings. Click it to refresh; it switches to a narrow, centred layout when the sidebar collapses to the icon rail.
- **Three explicit states**: signed out / loading / failed. **A failure never renders as `¥0.00`.**
- **No flash while refreshing**: the last known amount stays on screen while a re-read is in flight, with the tooltip marked as loading.
- **Native-looking tooltip**: built on the host's own `Tooltip` primitive, listing recharge balance, bonus balance and the last update time.
- **Bilingual**: copy goes through `ctx.locale` with zh / en dictionaries.
- **No build step**: a hand-written lazy-CJS browser bundle; `git clone` gives you an installable package with no runtime dependencies.

## Requirements

- DeepSeek Harness with a composition that serves the account subsystem (the Web / desktop composition does).
- The balance is read through the host's existing `account.getBalance` Remote; the plugin adds **no** Host capability of its own and its host half is an empty `apply()`.
- Node.js is only needed to run the bundled regression test.

## Install

The package is a DSH **bundle** (a host row) plus a **client plugin** (a browser bundle). Installation goes through the plugin manager, which invokes pnpm and registers the package as a bundle layer. Do **not** hand-edit the profile's `package.json` / `cordis.patch.yml`, and do not run pnpm inside the profile directory.

```sh
# A. install straight from GitHub (recommended) — a versioned copy in node_modules/.pnpm
plugin_manager action=install_bundle target=github:gggtmd/dsh-wallet-hud

# B. clone first, then install — a link: symlink, the clone *is* the plugin body
git clone https://github.com/gggtmd/dsh-wallet-hud ~/dsh-plugins/dsh-wallet-hud
plugin_manager action=install_bundle target=~/dsh-plugins/dsh-wallet-hud

# C. a release tarball, or the package name once published to npm
plugin_manager action=install_bundle target=https://github.com/gggtmd/dsh-wallet-hud/archive/refs/tags/v1.1.1.tar.gz
```

The GUI equivalent is **Settings → Plugins → Install** with the same spec in the field. The host treats `target` as `pnpm add <spec>`, so any spec pnpm accepts works.

| Install path | What lands on the machine | How to upgrade |
|---|---|---|
| A / C repo or tarball | versioned copy under `node_modules/.pnpm` | run `install_bundle` again |
| B local clone | `link:` symlink, the directory *is* the plugin | `git pull` |

```sh
# temporarily disable, keeping the install
plugin_manager action=set_plugin target=@local/dsh-wallet-hud enabled=false

# uninstall
plugin_manager action=remove_bundle target=@local/dsh-wallet-hud
```

After installing, refresh the page. Later changes to `client.js` (the browser half) only need a page refresh; changes to `index.js` (the host half), `package.json` or `locale/*.json` need an app restart, because the host caches plugin manifests.

## Usage

Hovering the chip shows:

```
充值余额  ¥1.99
赠送余额  ¥5.00
更新于 17:09:03 · 点击刷新
```

The second line appears only when the account actually has bonus balance. When signed out or when the query fails, the chip shows the corresponding placeholder and the tooltip explains why.

The balance is re-read on mount, on window focus / visibility change, every 5 minutes (only while the page is visible) and on click. At most one request is in flight at a time. The endpoint hits Platform for real on every call with no cache and no rate limit, hence the deliberately slow poll.

## How it works

```js
ctx.remote.account.getBalance({ version, locale, timezoneOffsetSeconds })
// → null                                                              signed out
// → { status: 'ready', value: [{ currency, balance }], bonusWallets } ok
// → { status: 'failed' }                                              retryable failure
```

States map to `ready` / `absent` / `failed` with their own copy and `data-state`. A failure is never rendered as an amount, and an in-flight refresh never withdraws the previous amount — degrading to "signed out" makes users think their session was lost (that was the 1.0.1 fix). While `ctx.get('remote.account')` is unavailable the plugin treats the composition as not yet assembled: it retries every 3 seconds and only after 5 consecutive misses reports that the composition serves no account service.

The tooltip uses the official `Tooltip` primitive rather than the `title` attribute, because a native `title` is drawn by the OS: it does not appear while the window is not key (which feels like "I have to click first"), and it cannot be laid out or themed. The bubble is a real DOM element driven only by mouse events. Its `white-space: pre-line` preserves newlines but collapses runs of ordinary spaces, so the label/amount columns are aligned with **non-breaking spaces** (`\u00a0`), and it is rendered with `side: 'top'`, `portal: true` and `maxWidth: 280`.

The browser half requires only two baseline modules: `react` and `@deepseek-ai/dsh-client-ui-primitives`. If `Tooltip` is missing the plugin falls back to a native `title` bubble instead of breaking. See [docs/implementation-notes.md](docs/implementation-notes.md) for the bundle format, host contracts and verification log (Chinese).

## Compatibility

- `CLIENT_VERSION` at the top of `client.js` (currently `0.2.0-rc.2`) is sent as `version` with the account query. If a Harness major release makes the query fail, update it.
- The UI uses only `--dsw-alias-*` theme tokens and imports no Harness client packages, so it follows the app's light and dark themes.

## Development

```sh
npm test                  # 21 assertions
LEGACY=1 npm test         # restores the 1.0.0 payload line in memory; 3 assertions fail on purpose
NO_PRIMITIVES=1 npm test  # simulates a composition without the Tooltip primitive
```

The test does not duplicate component logic: it captures the component handed to `ctx.slots.register` from the bundle, renders it for real, and drives six phases with a controllable `getBalance` promise.

## Contributing

Issues and pull requests are welcome. Please include the output of `npm test`, and for anything touching the browser half, describe how you verified it visually.

## License

[MIT](LICENSE) © 2026 gggtmd
