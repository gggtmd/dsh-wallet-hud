/**
 * Renders the real WalletBalance component straight out of the shipped bundle.
 *
 * The factory only exports `{ inject, apply }`, so the component is reached the
 * way the app reaches it: by capturing what `ctx.slots.register` receives.
 * No React runtime is involved — a stub records the element tree, and the
 * wallet store is driven directly so each phase can be asserted.
 *
 * `LEGACY=1 node test/render.test.mjs` restores the 1.0.0 payload line in memory
 * to show the regression this test exists for (the refresh flash of "未登录").
 */
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

// Control experiment: with LEGACY=1 the pre-fix payload line is restored in
// memory only, so the same assertions can show what the bug actually did.
const LEGACY = process.env.LEGACY === '1'
const patched = LEGACY
	? source.replace(
			'const payload = state.value',
			"const payload = state.phase === 'ready' ? state.value : undefined",
		)
	: source
if (LEGACY && patched === source) throw new Error('control patch did not apply')
console.log(LEGACY ? '### 对照实验：使用修复前的 payload 行 ###\n' : '### 当前代码 ###\n')

// ---- loader / DOM stubs -------------------------------------------------
let captured
globalThis.window = {
	__ModuleLoader__: { load: (spec) => { captured = spec } },
	addEventListener() {},
	removeEventListener() {},
}
globalThis.document = {
	hidden: false,
	querySelector: () => null,
	createElement: () => ({ dataset: {}, textContent: '' }),
	head: { appendChild() {} },
	addEventListener() {},
	removeEventListener() {},
}

// ---- minimal React that records the element tree ------------------------
const h = (type, props, ...children) => ({ type, props: props ?? {}, children })
const React = {
	createElement: h,
	useState: (v) => [v, () => {}],
	useEffect: () => {}, // no subscription: the store is driven directly
}

new Function(patched)()
const bundle = captured.factory((name) => {
	if (name === 'react') return React
	throw new Error('unexpected require: ' + name)
})

// ---- boot the plugin, capturing its pieces ------------------------------
let dict
let seat
const pending = []

const ctx = {
	effect: (fn) => fn(),
	locale: {
		register: (_ns, d) => { dict = d; return () => {} },
		getSnapshot: () => ({ active: 'zh' }),
	},
	get: () => ({
		getBalance: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
	}),
	slots: {
		inject: (_name, fn) => fn(),
		register: (spec, Component) => { seat = { spec, Component }; return () => {} },
	},
}
bundle.apply(ctx)
const store = seat.spec.inject().wallet

const t = (key, params) => {
	let s = dict.zh[key] ?? key
	for (const [k, v] of Object.entries(params ?? {})) s = s.replace('{' + k + '}', String(v))
	return s
}

// ---- helpers ------------------------------------------------------------
const textOf = (node) => {
	if (node === null || node === undefined || node === false) return ''
	if (typeof node === 'string' || typeof node === 'number') return String(node)
	if (Array.isArray(node)) return node.map(textOf).join('')
	return (node.children ?? []).map(textOf).join('')
}
/** Find a descendant element carrying one of this plugin's own classes. */
const byClass = (node, className) => {
	if (node === null || typeof node !== 'object') return undefined
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = byClass(child, className)
			if (found !== undefined) return found
		}
		return undefined
	}
	if (node.props?.className === className) return node
	for (const child of node.children ?? []) {
		const found = byClass(child, className)
		if (found !== undefined) return found
	}
	return undefined
}
const render = () => {
	const el = seat.Component({ wide: true, wallet: store, t })
	const amount = byClass(el, 'whud-amount')
	const label = byClass(el, 'whud-label')
	return {
		amount: amount === undefined ? undefined : textOf(amount),
		label: label === undefined ? undefined : textOf(label),
		state: el.props['data-state'],
		title: el.props.title,
	}
}
const ready = (balance) => ({
	ok: true,
	value: balance === null ? null : {
		status: 'ready',
		value: [{ currency: 'CNY', balance: String(balance) }],
		bonusWallets: [],
	},
})
const flush = () => new Promise((resolve) => setImmediate(resolve))

let failures = 0
const check = (label, actual, expected) => {
	const ok = actual === expected
	if (!ok) failures += 1
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
	if (!ok) console.log(`        实际: ${JSON.stringify(actual)}\n        期望: ${JSON.stringify(expected)}`)
}

// ---- scenario -----------------------------------------------------------
console.log('--- 1. 首次加载中（phase=loading）---')
store.refresh()
let r = render()
check('占位文案', r.label, '余额 查询中')
check('此时没有金额节点', r.amount, undefined)
check('data-state', r.state, 'loading')

console.log('\n--- 2. 首次加载完成 ---')
pending.shift().resolve(ready('3.63'))
await flush()
r = render()
check('标签', r.label, '余额')
check('金额', r.amount, '¥3.63')
check('data-state', r.state, 'ready')

console.log('\n--- 3. 点击刷新：请求在途（phase=refreshing，1.0.1 的修复点）---')
store.refresh()
r = render()
check('金额节点仍在', r.amount, '¥3.63')
check('标签没有退化成未登录', r.label, '余额')
check('data-state 保持 ready', r.state, 'ready')
check('tooltip 里出现「查询中」', r.title.includes('查询中'), true)

console.log('\n--- 4. 刷新返回，金额更新 ---')
pending.shift().resolve(ready('12.34'))
await flush()
r = render()
check('金额已更新', r.amount, '¥12.34')

console.log('\n--- 5. 刷新失败（不能伪装成 0.00，也不能继续显示旧值）---')
const failed = store.refresh()
pending.shift().reject(new Error('boom'))
await failed
r = render()
check('占位文案', r.label, '余额 查询失败')
check('金额节点已撤下', r.amount, undefined)
check('data-state', r.state, 'failed')

console.log('\n--- 6. 账号未登录（value=null）---')
store.refresh()
pending.shift().resolve(ready(null))
await flush()
r = render()
check('占位文案', r.label, '余额 未登录')
check('金额节点已撤下', r.amount, undefined)
check('data-state', r.state, 'absent')

console.log(`\n${failures === 0 ? '全部通过' : failures + ' 项失败'}`)
process.exit(failures === 0 ? 0 : 1)
