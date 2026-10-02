# 实现笔记

面向要改这个插件的人。[README](../README.md) 只讲使用；这里记 bundle 格式、宿主内部契约，以及当初的验证过程。

## 加载链路

本包同时是两样东西：

- **bundle**：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，插件管理器把它登记为 profile 的一个 bundle 层；
- **client 插件**：`package.json` 的 `dsh.client` 声明 `platform: web`、`immediately: true` 与 inject 列表，宿主把 `exports["./client"]` 编进浏览器启动图。

`index.js` 必须存在（Loader 要 import 这个包的 host 导出），但它只是空 `apply()`——余额完全来自宿主账户子系统已有的 Remote。

## 手写 lazy-CJS bundle 格式

`client.js` 不经构建，格式与官方模板一致：

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-wallet-hud',   // 必须等于包名
  factory(require) { /* … */ return { inject: [...], apply(ctx) { /* … */ } } },
})
```

要点：

- 加载器取的是**工厂的返回值**作为 `exports`（实现里就是 `exports: registered.factory(require)`），所以模板这种"返回 exports"的写法成立；
- 工厂内所有 `require()` 必须落在浏览器基线模块表里：`react`、`react/jsx-runtime`、`react-dom`、`cordis`、`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-ui-dockkit`。本插件只用前两个中的 `react` 与 primitives 的 `Tooltip`；
- 样式在 `apply()` 里以 `<style data-plugin-css="@local/dsh-wallet-hud/wallet-hud.css">` 注入，类名统一 `whud-` 前缀；
- `ui-primitives` 是**基线模块**，不是可注入的 client 条目，所以**不要**把它列进 `dsh.client.inject`——官方 `ui-settings-account` 等包同样直接 `require` 而不声明 inject。

宿主侧对 bundle 资源的缓存是 immutable（`public, max-age=31536000, immutable`），但会记录字节并按源文件的 mtime / ctime / size 判断是否需要重新打包，所以改完 `client.js` 刷新页面即可拿到新代码。

## 槽位与注入契约

- 座位：`sidebar.footer.action`（list 槽位，由 `dsh-client-ui-sidebar` 声明），座位 id `wallet-balance`，`order: 30`；
- owner 通过 props 传 `{ wide }`：`wide === false` 表示侧边栏处于折叠导轨状态，胶囊据此切成窄版；
- `inject: ['slots', 'locale', 'remote']`，用 `ctx.slots.inject(...)` 声明注入、`ctx.slots.register(...)` 注册组件，`inject: () => ({ wallet })` 注 props；
- `ctx.locale` 绑定命名空间后得到 `t`；
- `remoteServiceKey(namespace) === 'remote.' + namespace`，因此 `ctx.get('remote.account')` 成立。

## 悬浮提示的两个坑

1. **对齐必须用不换行空格 `\u00a0`**。气泡是 `white-space: pre-line`：换行会保留，但连续普通空格会被折叠成一个，用两个 `\u0020` 对齐无效。
2. **`Tooltip` 会在锚点外再包一层块级 span**，胶囊不再是"被 flex 拉伸的 item"，会顶上对齐、整体上移。所以有一条 `.whud-chip{height:100%}` 让它撑满该行。用真实侧边栏 CSS 在无头 Chrome 里量过：

   ```
   无包装:            chipH=50.0  chipCenter=25.0
   加包装:            chipH=40.0  chipCenter=20.0   ← 上移 5px
   加 height:100%:    chipH=50.0  chipCenter=25.0   ← 与原状一致
   ```

   折叠导轨里父高度是 auto，`height:100%` 会回落成 auto，无副作用。

另外 `Tooltip` 的 `label` 是 `string | (() => string)`，取不到该原语时插件退回原生 `title` 气泡，不会整块挂掉。

## 为什么没有图标

清单里没有顶层 `icon` 字段，也没有 `icon.svg`。这两处必须**同时**处理：宿主 `@deepseek-ai/dsh-app-boot`（`lib/types/package-meta.js` 的 `iconOf()`）在扫描清单时直接 `realpathSync` + `statSync` 读文件并内联成 data URL。只删文件不删字段会让元数据读取抛错、插件卡片带一条错误诊断；只删字段则干净回落到默认图形。

要恢复图标：把文件写回 `icon.svg`，并在 `package.json` 加回 `"icon": "./icon.svg"`（路径必须是包内相对路径、常规文件、≤256 KiB，后缀限 svg/png/jpg/jpeg/webp）：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none">
  <rect x="2.75" y="5.75" width="18.5" height="12.5" rx="3" stroke="#4d6bfe" stroke-width="1.5"/>
  <path d="M2.75 10.25h18.5" stroke="#4d6bfe" stroke-width="1.5"/>
  <circle cx="16.75" cy="14.25" r="1.5" fill="#4d6bfe"/>
</svg>
```

## 插件管理器卡片文案

`locale/*.json` 是给**插件管理器卡片**用的一套文案，与运行时的 `ctx.locale` 字典无关：宿主读 `locale/en.json` 的 `meta.title` / `meta.description`（描述回退到 `package.json` 的 `description`）。它要求 `exports` 暴露 `./locale/*.json`，且宿主会缓存插件清单，所以新增或修改 locale 文件要**重启 App** 才显示。

## 安装机制

安装由插件管理器完成：`install_bundle` 的 `target` 原样交给 `pnpm add <spec>`，随后把包写进 profile 清单，并在 `dsh.profile.bundles` 里追加本包作为一个 bundle 层（顺序在官方 `dsh-base`、`dsh-web-app` 之后）。启动器树里的 `wallet-hud` 行来自**本目录自带的 `cordis.patch.yml`**，profile 自己的补丁层不涉及本插件。

两种落到磁盘的形态：

| spec | 结果 | 与源码目录的关系 |
|---|---|---|
| 本地路径 / clone | `link:` 软链接 | 目录就是插件本体，删目录即失效 |
| `github:` / tarball / npm 包名 | `node_modules/.pnpm` 里的版本化副本 | 与源码解耦，`pnpm` 打包时按 `files` 字段裁剪（`README*`、`LICENSE`、`package.json` 总是带上） |

`pnpm add github:<user>/<repo>` 会走 codeload 拉取仓库某个 commit 的 tarball，实测装出来是 `@local+dsh-wallet-hud@https+++codeload.github.com+…+<sha>` 这样的目录名，`test/`、`docs/` 因为不在 `files` 里不会进副本。

**不要**手写 profile 的 `package.json` / `cordis.patch.yml`，也不要在 profile 目录里跑 pnpm——官方持久插件文档明确排除这种做法。

## 验证记录

在宿主进程内用临时探针行（已删除）实测：

- profile 补丁**热重载生效**，新插入的行约 6 秒内挂载；
- `wallet-hud` 这一行 fiber 状态 = **active**，189 个条目无失败项；
- 包从 profile 锚点解析成功：`platform: "web"`、`exports["./client"]` 存在、bundle 注册的 id 与包名一致；
- 宿主已把本插件编入客户端启动图（`entries[67]`），并进入浏览器实际加载的 combo 批次；
- 通过宿主自己的 bundle carrier 取回该资源：**HTTP 200**、`text/javascript`、immutable 缓存头，内容包含本插件的样式类、中文文案与自身 id 注册；改动 `client.js` 后版本号自动更新，且返回字节含最新代码；
- 契约层面按宿主 0.2.0 源码逐条核对：槽位 `sidebar.footer.action`、`ctx.slots.inject/register` 选项、`locale: NS` 绑定 `t`、`inject: () => ({…})`、`remoteServiceKey`、`getBalance` 三态结果。

用桩环境（假 `window.__ModuleLoader__`、`document`、`react`）真实执行 factory 与 `apply()`：

```
inject list    : ["slots","locale","remote"]
slots injected : ["sidebar.footer.action"]
seats          : [{"slot":"sidebar.footer.action","id":"wallet-balance","order":30}]
```

即 bundle 可加载、`apply()` 无悬空引用、只注册余额这一处座位。

`test/render.test.mjs` 不复制组件逻辑，而是从 bundle 里捕获 `ctx.slots.register` 收到的组件本体再真实渲染，用可控的 `getBalance` promise 驱动六个阶段（首次加载中 / 加载完成 / 刷新在途 / 刷新返回 / 刷新失败 / 未登录），并覆盖 tooltip 排版与依赖回落，共 21 项断言：

```
$ npm test                 全部通过
$ LEGACY=1 npm test        3 项失败（复现 1.0.0 的「未登录」闪烁）
$ NO_PRIMITIVES=1 npm test 全部通过（退回原生 title）
```

`LEGACY=1` 的失败输出即修复前的现象：任何一次重新读取（点击、聚焦、5 分钟轮询）都会让金额瞬间被「未登录」顶掉，直到响应返回。

**已知的滞后（无功能影响）**：`package.json` 与 `locale/*.json` 的改动会被宿主的插件清单缓存挡住，要**重启 App** 才反映到启动图的行上。这不影响渲染，因为余额座位由 `dsh-client-ui-sidebar` 声明，而该包仍在 inject 列表里。
