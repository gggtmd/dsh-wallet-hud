/**
 * Wallet HUD — browser half.
 *
 * Registers one seat in the Harness Web UI:
 *   - `sidebar.footer.action` → wallet balance of the signed-in account
 *
 * The balance is read through the account Remote the desktop composition
 * already mounts (`account.getBalance`), so the Host half of this bundle stays
 * empty.
 *
 * Written by hand in the lazy-CJS bundle format `dsh-client-modules` serves:
 * a factory registered under the package id, requiring only baseline platform
 * modules (`react`, `react/jsx-runtime` is not needed here since no JSX is used).
 */
window.__ModuleLoader__.load({
	id: '@local/dsh-wallet-hud',
	factory: (require) => {
		const React = require('react')

		/** Locale namespace of this plugin's dictionaries. */
		const NS = 'wallet-hud'
		/** Account metadata requires a client build version; mirrors the deployed app. */
		const CLIENT_VERSION = '0.2.0-rc.2'
		/**
		 * Balance re-read cadence while at least one chip is mounted and the page is
		 * visible. `account.getBalance` reaches Platform over the network with no
		 * cache and no rate limit, and the account UI itself refreshes on account
		 * watch frames rather than on a timer; this slow poll exists only so the
		 * chip still tracks spend made outside this page, and it is combined with a
		 * refresh on every focus or visibility change.
		 */
		const REFRESH_INTERVAL_MS = 300_000

		/** Currency symbols for the two currencies Platform reports. */
		const SYMBOLS = { CNY: '\u00a5', USD: '$' }
		/** Currency assumed before the account reports its wallets. */
		const FALLBACK_CURRENCY = 'CNY'

		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			'wallet.label': '余额',
			'wallet.loading': '查询中',
			'wallet.failed': '查询失败',
			'wallet.signedOut': '未登录',
			'wallet.refresh': '刷新余额',
			'wallet.tooltip.recharge': '充值余额',
			'wallet.tooltip.bonus': '赠送余额',
			'wallet.tooltip.updated': '更新于 {time}',
			'wallet.tooltip.hint': '点击刷新',
			'wallet.tooltip.signedOut': '当前没有已登录的账号',
			'wallet.error.unsupported': '当前组合未提供账户服务',
		}

		/** English dictionary, key-identical to the Chinese source of truth. */
		const en = {
			'wallet.label': 'Balance',
			'wallet.loading': 'Loading',
			'wallet.failed': 'Unavailable',
			'wallet.signedOut': 'Signed out',
			'wallet.refresh': 'Refresh balance',
			'wallet.tooltip.recharge': 'Top-up balance',
			'wallet.tooltip.bonus': 'Granted balance',
			'wallet.tooltip.updated': 'Updated {time}',
			'wallet.tooltip.hint': 'Click to refresh',
			'wallet.tooltip.signedOut': 'No account is signed in',
			'wallet.error.unsupported': 'This composition serves no account service',
		}

		/** Styles for the seat; every value is a theme token with a literal fallback. */
		const css = `
.whud-chip{display:inline-flex;box-sizing:border-box;align-items:center;gap:6px;max-width:100%;min-height:28px;padding:3px 8px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font:inherit;font-size:var(--dsw-font-xs-13,13px);line-height:18px;cursor:pointer;white-space:nowrap;overflow:hidden}
.whud-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,#111827)}
.whud-chip:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,#3b82f6);outline-offset:1px}
.whud-chip[data-state="failed"]{color:var(--dsw-alias-state-error-primary,#dc2626)}
.whud-chip .whud-amount{color:var(--dsw-alias-label-primary,#111827);font-variant-numeric:tabular-nums}
.whud-chip .whud-label{color:var(--dsw-alias-label-tertiary,#9ca3af);overflow:hidden;text-overflow:ellipsis}
.whud-chip[data-wide="false"]{justify-content:center;padding:3px 4px}
`
		/** Idempotence key for the injected style element. */
		const CSS_TAG_ID = '@local/dsh-wallet-hud/wallet-hud.css'

		/**
		 * Inject this plugin's stylesheet once and return its remover.
		 * @param doc - owning document.
		 * @returns disposer removing the element this call created.
		 */
		function injectStyles(doc) {
			if (doc.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG_ID) + ']') !== null) return () => {}
			const tag = doc.createElement('style')
			tag.dataset.plugin = '@local/dsh-wallet-hud'
			tag.dataset.pluginCss = CSS_TAG_ID
			tag.textContent = css
			doc.head.appendChild(tag)
			return () => tag.remove()
		}

		// ------------------------------------------------------------------
		// Formatting
		// ------------------------------------------------------------------

		/**
		 * Render a wallet balance string, which Platform may pad with zeros.
		 * @param text - balance as reported by Platform.
		 * @returns fixed two-decimal text, or the original when not numeric.
		 */
		function formatBalance(text) {
			const value = Number(text)
			return Number.isFinite(value) ? value.toFixed(2) : String(text)
		}

		/**
		 * Format a timestamp for the balance tooltip.
		 * @param at - epoch milliseconds.
		 * @returns local wall-clock time.
		 */
		function formatTime(at) {
			const date = new Date(at)
			const pad = (value) => String(value).padStart(2, '0')
			return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
		}

		// ------------------------------------------------------------------
		// Balance store
		// ------------------------------------------------------------------

		/**
		 * Read-side cache of the account balance, polled only while a chip is
		 * mounted. Every fetch carries fresh account metadata, because the Host
		 * reports the requesting UI's language and zone to Platform.
		 * @param ctx - client root context.
		 * @returns store with `snapshot`, `subscribe`, and `refresh`.
		 */
		function createWalletStore(ctx) {
			const listeners = new Set()
			let snapshot = { phase: 'idle', value: undefined, error: undefined, at: 0, currency: FALLBACK_CURRENCY, service: false }
			let timer
			let inFlight
			let retryTimer
			let missingAttempts = 0

			const emit = (next) => {
				snapshot = { ...snapshot, ...next }
				for (const listener of [...listeners]) {
					try {
						listener()
					} catch (error) {
						console.error('[wallet-hud] balance listener failed', error)
					}
				}
			}

			/** @returns account metadata for one Remote call, read at call time. */
			const metadata = () => ({
				version: CLIENT_VERSION,
				locale: ctx.locale.getSnapshot().active,
				timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
			})

			/**
			 * Adopt one Host balance payload, deriving the display currency from it.
			 * @param value - `account.getBalance` result value.
			 * @returns the resolved display currency.
			 */
			const adopt = (value) => {
				const ready = value != null && value.status === 'ready'
				const normal = ready ? value.value : []
				const bonus = ready ? value.bonusWallets : []
				const positive = normal.find((wallet) => Number(wallet.balance) > 0)
				const currency = (positive ?? normal[0] ?? bonus[0])?.currency ?? FALLBACK_CURRENCY
				emit({ currency })
				return currency
			}

			/** Read the balance once, keeping a single in-flight request. */
			const refresh = () => {
				if (inFlight !== undefined) return inFlight
				const account = ctx.get('remote.account')
				if (account === undefined) {
					// The account namespace mounts with the application assembly, so a
					// miss here means "not composed yet" rather than a failure: retry
					// briefly and only then report this deployment as serving no account.
					missingAttempts += 1
					if (missingAttempts >= 5) {
						emit({ phase: 'failed', error: 'unsupported', service: false })
						return Promise.resolve()
					}
					emit({ phase: 'loading', service: false })
					if (retryTimer === undefined) {
						retryTimer = setTimeout(() => {
							retryTimer = undefined
							void refresh()
						}, 3000)
					}
					return Promise.resolve()
				}
				if (retryTimer !== undefined) {
					clearTimeout(retryTimer)
					retryTimer = undefined
				}
				missingAttempts = 0
				emit({ phase: snapshot.at === 0 ? 'loading' : 'refreshing', service: true })
				inFlight = (async () => {
					try {
						const result = await account.getBalance(metadata())
						if (!result.ok) throw new Error(result.error.code + ': ' + result.error.message)
						adopt(result.value)
						emit({ phase: 'ready', value: result.value, error: undefined, at: Date.now() })
					} catch (error) {
						emit({ phase: 'failed', error: String((error && error.message) || error), at: Date.now() })
					} finally {
						inFlight = undefined
					}
				})()
				return inFlight
			}

			/** Re-read after the tab regains focus or becomes visible again. */
			const wake = () => {
				if (typeof document === 'undefined' || document.hidden) return
				void refresh()
			}

			return {
				get snapshot() {
					return snapshot
				},
				/** @returns disposer dropping this subscription. */
				subscribe(listener) {
					listeners.add(listener)
					if (listeners.size === 1) {
						void refresh()
						timer = setInterval(() => {
							if (typeof document === 'undefined' || !document.hidden) void refresh()
						}, REFRESH_INTERVAL_MS)
						window.addEventListener('focus', wake)
						document.addEventListener('visibilitychange', wake)
					}
					let live = true
					return () => {
						if (!live) return
						live = false
						listeners.delete(listener)
						if (listeners.size > 0) return
						clearInterval(timer)
						timer = undefined
						clearTimeout(retryTimer)
						retryTimer = undefined
						window.removeEventListener('focus', wake)
						document.removeEventListener('visibilitychange', wake)
					}
				},
				refresh,
			}
		}

		/**
		 * Subscribe a component to one wallet store.
		 * @param store - store returned by `createWalletStore`.
		 * @returns the current snapshot, updated in place.
		 */
		function useWalletStore(store) {
			const [snapshot, setSnapshot] = React.useState(store.snapshot)
			React.useEffect(() => store.subscribe(() => setSnapshot(store.snapshot)), [store])
			return snapshot
		}

		// ------------------------------------------------------------------
		// Components
		// ------------------------------------------------------------------

		/**
		 * Sidebar foot chip showing the account's wallet balance.
		 * @param props - sidebar `wide` flag, the wallet store, and the translator.
		 */
		function WalletBalance({ wide = true, wallet, t }) {
			const state = useWalletStore(wallet)
			const payload = state.phase === 'ready' ? state.value : undefined
			/**
			 * Outcome of the last read. `absent` is the account service reporting no
			 * signed-in account and `failed` is an in-band or thrown query failure;
			 * neither may be rendered as a zero balance.
			 */
			const outcome =
				state.phase === 'idle' || state.phase === 'loading'
					? 'loading'
					: state.phase === 'failed'
						? 'failed'
						: payload == null
							? 'absent'
							: payload.status === 'ready'
								? 'ready'
								: 'failed'
			const normal = outcome === 'ready' ? payload.value : []
			const bonus = outcome === 'ready' ? payload.bonusWallets : []
			const currency = state.currency
			const symbol = SYMBOLS[currency] ?? currency + ' '
			const owned = normal.filter((entry) => entry.currency === currency)
			const bonusOwned = bonus.filter((entry) => entry.currency === currency)
			const total = owned.reduce((sum, entry) => sum + Number(entry.balance), 0)
			const bonusTotal = bonusOwned.reduce((sum, entry) => sum + Number(entry.balance), 0)

			const lines = []
			if (owned.length > 0) {
				lines.push(t('wallet.tooltip.recharge'))
				for (const entry of owned) lines.push('  ' + (SYMBOLS[entry.currency] ?? entry.currency + ' ') + formatBalance(entry.balance))
			}
			if (bonusTotal > 0) {
				lines.push(t('wallet.tooltip.bonus'))
				for (const entry of bonusOwned) lines.push('  ' + (SYMBOLS[entry.currency] ?? entry.currency + ' ') + formatBalance(entry.balance))
			}
			if (outcome === 'absent') lines.push(t('wallet.tooltip.signedOut'))
			if (outcome === 'failed') {
				lines.push(state.error === 'unsupported' ? t('wallet.error.unsupported') : state.error ?? t('wallet.failed'))
			}
			if (state.at > 0) lines.push(t('wallet.tooltip.updated', { time: formatTime(state.at) }))
			lines.push(t('wallet.tooltip.hint'))

			const placeholder =
				outcome === 'loading' ? t('wallet.loading') : outcome === 'failed' ? t('wallet.failed') : t('wallet.signedOut')

			return React.createElement(
				'button',
				{
					type: 'button',
					className: 'whud-chip',
					'data-state': outcome,
					'data-wide': wide ? 'true' : 'false',
					title: lines.join('\n'),
					'aria-label': t('wallet.refresh'),
					onClick: () => void wallet.refresh(),
				},
				outcome === 'ready'
					? [
							wide
								? React.createElement('span', { key: 'label', className: 'whud-label' }, t('wallet.label'))
								: null,
							React.createElement(
								'span',
								{ key: 'amount', className: 'whud-amount' },
								symbol + total.toFixed(2),
							),
						]
					: React.createElement(
							'span',
							{ className: 'whud-label' },
							wide ? t('wallet.label') + ' ' + placeholder : placeholder,
						),
			)
		}

		return {
			inject: ['slots', 'locale', 'remote'],
			/**
			 * Register the dictionaries, the shared balance store, and the seat.
			 * @param ctx - client root context.
			 */
			apply(ctx) {
				ctx.effect(() => injectStyles(document), 'wallet-hud: stylesheet')
				ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'wallet-hud: dictionaries')

				const wallet = createWalletStore(ctx)

				ctx.slots.inject('sidebar.footer.action', () =>
					ctx.slots.register(
						{
							name: 'sidebar.footer.action',
							id: 'wallet-balance',
							order: 30,
							locale: NS,
							inject: () => ({ wallet }),
						},
						WalletBalance,
					),
				)
			},
		}
	},
})
