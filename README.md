# Wallet HUD

在 DeepSeek Harness Web UI 里加一处显示：

| 位置 | 槽位 | 内容 |
|---|---|---|
| 侧边栏底部（设置按钮旁） | `sidebar.footer.action` | 已登录账号的钱包余额，点一下刷新 |

它同时是一个 **bundle**（host 行）+ **client 插件**（浏览器 bundle）。host 半边是空实现：余额来自宿主已有的能力（`account.getBalance`），插件本身不新增任何 host 接口。

## 数据来源

复用账户子系统已有的 Remote `ctx.remote.account.getBalance({version, locale, timezoneOffsetSeconds})`。
返回 `null`（未登录/凭据换代）｜`{status:'ready', value:[{currency,balance}], bonusWallets:[…]}`｜`{status:'failed'}`（可重试）。
三种状态分别渲染为「未登录」「金额」「查询失败」，**任何失败都不会显示成 ¥0.00**。刷新期间（phase `refreshing`）**继续显示上一次的金额**，tooltip 里补一行「查询中」——否则重新读取的瞬间会退化成「未登录」，看起来像掉了登录态（1.0.1 修的就是这个）。

`version`/`locale`/`timezoneOffsetSeconds` 每次调用时现取，因为宿主会把请求方 UI 的语言和时区报给 Platform。

该调用每次都会真实访问 `{platformOrigin}/api/v0/users/get_user_summary`（无缓存、无限流），所以刷新节奏是：挂载时 + 窗口重新聚焦/可见时 + 每 5 分钟一次（`REFRESH_INTERVAL_MS`，仅在页面可见且有订阅者时轮询）+ 手动点击。同一时刻只保留一个在途请求；`ctx.get('remote.account')` 暂时取不到时按「组合尚未装配」处理，每 3 秒重试、连续 5 次才报「当前组合未提供账户服务」。

币种取钱包自己上报的币种（优先有正余额的钱包），暂时取不到时按 `CNY` 显示。

## 悬浮提示

用官方 `Tooltip` 原语（`@deepseek-ai/dsh-client-ui-primitives`）而不是 `title` 属性：

- **原生 `title` 是系统绘制的**，窗口未激活时不弹——表现为"要先点一下窗口才能看到提示"；而且它无法排版、无法主题化。换成 DOM 内的气泡后只受鼠标事件驱动。
- `Tooltip` 的气泡样式是 `white-space: pre-line`，所以**换行会保留**，`label` 传多行字符串即可；底色取自 `--dsw-alias-tooltip-bg`，与全应用其它 tooltip 一致。
- 参数：`side: 'top'`（弹在胶囊上方）、`portal: true`（挂到 `document.body`，免受侧边栏祖先的裁剪/层叠上下文影响）、`maxWidth: 280`（长错误信息不会撑到默认的半屏宽）。

排版规则（`client.js` 里 `lines` 的构造）：

```
充值余额  ¥1.99              ← 类别与金额同一行
赠送余额  ¥5.00              ← 有赠送余额时才出现
更新于 17:09:03 · 点击刷新    ← 新鲜度与唯一操作合并成一行
```

两处细节值得记下来，否则会踩坑：

1. **间隔必须用不换行空格 `\u00a0`**。`pre-line` 会把连续普通空格折叠成一个，用两个 `\u0020` 对齐是无效的。
2. `Tooltip` 会在胶囊外**再包一层块级锚点 span**，胶囊就不再是被拉伸的 flex item，会顶上对齐。所以有一条 `.whud-chip{height:100%}` 让它撑满该行——用真实侧边栏 CSS 量过：加与不加这层包装，胶囊几何完全一致（`chipH=50`、`chipCenter=25`）。

## 文件

```
package.json        包清单：dsh.bundle.patch + dsh.client(platform:web, immediately:true)
cordis.patch.yml    bundle 的补丁：insert 一行 wallet-hud
index.js            host 半边，空 apply()（必须存在，供 Loader import）
client.js           浏览器 bundle（手写 lazy-CJS 格式，只 require 两个基线模块：react、ui-primitives）
locale/en.json      插件管理器卡片文案（标题/描述），zh.json 同结构
test/render.test.mjs 渲染回归测试（`npm test`；`LEGACY=1` 复现 1.0.0 的「未登录」闪烁）
```

`client.js` 是手写的、不经过构建的 bundle，格式与官方模板一致：

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-wallet-hud',   // 必须等于包名
  factory(require) { … return { inject: [...], apply(ctx) {…} } },
})
```

加载器的实际实现里 `exports` 取的是**工厂的返回值**（`exports: registered.factory(require)`），所以模板这种"返回 exports"的写法成立；而 `client.js` 里所有 `require()` 都必须落在浏览器基线模块表（react、react/jsx-runtime、react-dom、cordis、dsh-client-store、dsh-client-ui-slots、dsh-client-ui-primitives、dsh-client-ui-dockkit）里。本插件用到两个：`react` 与 `@deepseek-ai/dsh-client-ui-primitives` 的 `Tooltip`。

`ui-primitives` 是**基线模块**，不是可注入的 client 条目——所以它**不**需要（也不应该）列进 `dsh.client.inject`；官方 `ui-settings-account` 等包同样直接 `require` 它而不声明 inject。`Tooltip` 取不到时插件会退回原生 `title` 气泡，不会整块挂掉。

UI 只用 `--dsw-alias-*` 主题 token，不 import 任何 Harness 客户端包（官方 `practices.md` 的要求），文案走 `ctx.locale`（zh/en 双字典，键集以 `zh` 为准）。

`locale/*.json` 是给**插件管理器卡片**用的另一套文案：宿主从 `locale/en.json` 的 `meta.title`/`meta.description` 读取（描述回退到 `package.json` 的 `description`）。它需要 `exports` 暴露 `./locale/*.json`，且宿主会**缓存插件清单**，所以新增或修改 locale 文件要**重启 App** 才显示。

**图标已移除**：清单原先有顶层 `"icon": "./icon.svg"` 与 `icon.svg` 文件，现已一并删除，插件管理器卡片回落到默认图形。两处必须同时删——宿主 `@deepseek-ai/dsh-app-boot`（`lib/types/package-meta.js` 的 `iconOf()`）在扫描清单时直接 `realpathSync` + `statSync` 读文件并内联成 data URL，只删文件不删字段会让元数据读取抛错、卡片带一条错误诊断；只删字段则干净回落到默认图形。要恢复图标，重新写回 `icon.svg` 并在 `package.json` 加回 `"icon": "./icon.svg"` 即可：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none">
  <rect x="2.75" y="5.75" width="18.5" height="12.5" rx="3" stroke="#4d6bfe" stroke-width="1.5"/>
  <path d="M2.75 10.25h18.5" stroke="#4d6bfe" stroke-width="1.5"/>
  <circle cx="16.75" cy="14.25" r="1.5" fill="#4d6bfe"/>
</svg>
```

## 安装状态与卸载

按官方 `cordis-plugin-development` 的持久插件流程安装：**源码留在 workspace，安装交给插件管理器**。

```sh
plugin_manager action=install_bundle target=~/dsh-plugins/dsh-wallet-hud
```

它替我们做完这几件事（**都不要手写**）：

- profile 清单 `~/.dsh/profiles/<profile>/package.json`：
  `dependencies` 记 `"@local/dsh-wallet-hud": "link:~/dsh-plugins/dsh-wallet-hud"`，
  `dsh.profile.bundles` 追加本包作为**第三层 bundle**（在 `dsh-base`、`dsh-web-app` 之后）；
- profile 的 `node_modules/` 由 pnpm 接管（含 `.pnpm`、`.pnpm-workspace-state-v1.json`、`pnpm-lock.yaml`）；
- 启动器树的 `wallet-hud` 行由**本目录自带的 `cordis.patch.yml`** 铺出，profile 自己的补丁层不涉及本插件。

卸载：

```sh
plugin_manager action=remove_bundle target=@local/dsh-wallet-hud
```

只想临时停用就 `set_plugin`（改 `enabled`），不必卸载。**不要**手写 profile 的 `package.json` / `cordis.patch.yml`、不要在 profile 目录里跑 pnpm——那是本插件早期的手工做法（软链接 + 手改 patch 行），已废弃；当时的补丁备份仍留在 `~/.dsh/profiles/<profile>/cordis.patch.yml.bak-*`。

改完 `client.js` 后：宿主会**重新生成**该 bundle 的版本号，**刷新页面**即可拿到新代码；只有替换 host 半边（`index.js`）才需要重启 App（官方 host-plugin 文档的约束）。

## 分享给别人

本包自包含（手写 bundle，**无构建步骤**，`package.json` 里没有 `scripts`），所以 `git clone` 下来就是可直接安装的包。

```sh
# 方式 A：clone 到本地再装（插件本体就是 clone 目录，git pull 即更新）
git clone <repo-url> ~/dsh-plugins/dsh-wallet-hud
plugin_manager action=install_bundle target=~/dsh-plugins/dsh-wallet-hud

# 方式 B：让 pnpm 直接取仓库（装成 .pnpm 里的副本，不依赖对方保留仓库）
plugin_manager action=install_bundle target=github:<user>/dsh-wallet-hud

# 方式 C：Release 的 tarball URL，或发布到 npm 后的包名
plugin_manager action=install_bundle target=https://github.com/<user>/dsh-wallet-hud/archive/refs/tags/v1.0.0.tar.gz
```

宿主对 `target` 的处理就是 `pnpm add <spec>`，所以 pnpm 认的 spec 都能用。图形界面等价：**设置 → Plugins → 安装**，框里填同一个 spec。

| 安装方式 | 落到对方机器上的是什么 | 升级方式 |
|---|---|---|
| A 本地目录 / clone | `link:` 软链接，**插件本体就是那个目录** | `git pull`（宿主按 mtime 重新打包该 bundle） |
| B / C 仓库或 tarball、npm | `node_modules/.pnpm` 里的**版本化副本** | 重新执行一次 `install_bundle` |

`package.json` 的 `files` 字段决定了发布出去的文件（`index.js`、`client.js`、`cordis.patch.yml`、`locale/*.json`；`README.md` 与 `package.json` 由 npm 自动带上）。

**发版纪律**：改完代码同时改 `package.json` 的 `version` 并打同号 tag，对方钉 tag 才钉得住（A 方式靠 tag 说明该 pull 到哪一版）。

**兼容性注意**：`client.js` 顶部的 `CLIENT_VERSION` 是写死的（当前 `0.2.0-rc.2`），它会作为 `version` 报给 Platform 的账户接口。对方 DSH 大版本不同时应跟着改，否则余额查询可能被服务端拒绝。

## 已完成的验证

在宿主进程内用临时探针行（已删除）实测：

- profile 补丁**热重载生效**，新插入的行约 6 秒内挂载；
- `wallet-hud` 这一行 fiber 状态 = **active**，189 个条目无失败项；
- 包从 profile 锚点解析成功：`platform: "web"`、`exports["./client"]` 存在、bundle 注册的 id 与包名一致；
- 宿主已把本插件编入客户端启动图（`entries[67]`），并进入浏览器实际加载的 combo 批次；
- 通过宿主自己的 bundle carrier 取回该资源：**HTTP 200**、`text/javascript`、immutable 缓存头，内容包含本插件的样式类、中文文案与自身 id 注册；改动 `client.js` 后版本号自动更新，且返回字节含最新代码；
- 插件管理器元数据：描述取自 `package.json`（`locale` 标题需重启 App，见上）。当时 `icon` 还解析为 `data:image/svg+xml;base64,…`；该图标现已连同清单字段一并删除，见上文；
- 契约层面按 0.2.0 源码逐条核对：槽位 `sidebar.footer.action`（owner 传 `{wide}`）、`ctx.slots.inject/register` 选项、`locale: NS` 绑定 `t`、`inject: () => ({…})` 注入 props、`remoteServiceKey(namespace) = "remote." + namespace`（即 `ctx.get('remote.account')` 成立）、`getBalance` 三态结果。

移除会话消耗座位后，用桩环境（假 `window.__ModuleLoader__`、`document`、`react`）真实执行了 factory 与 `apply()`，结果：

```
inject list    : ["slots","locale","remote"]
slots injected : ["sidebar.footer.action"]
seats          : [{"slot":"sidebar.footer.action","id":"wallet-balance","order":30}]
```

即 bundle 可加载、`apply()` 无悬空引用、只注册余额这一处座位；`package.json` 的 `dsh.client.inject` 也同步去掉了 `ui-conversation` 与 `ui-chat`（原先只为 `conversation.composer.dock` 的归属与排序而加）。

**1.0.1 的修复有回归测试**：`test/render.test.mjs` 不复制组件逻辑，而是从 bundle 里**捕获 `ctx.slots.register` 收到的组件本体**再真实渲染它，用可控的 `getBalance` promise 逐步驱动六个阶段（首次加载中 / 加载完成 / 刷新在途 / 刷新返回 / 刷新失败 / 未登录），共 15 项断言。

```
$ npm test
全部通过
$ LEGACY=1 npm test      # 把 1.0.0 的那行 payload 在内存里还原
--- 3. 点击刷新：请求在途 ---
FAIL  金额节点仍在        实际: undefined      期望: "¥3.63"
FAIL  标签没有退化成未登录  实际: "余额 未登录"   期望: "余额"
FAIL  data-state 保持 ready 实际: "absent"      期望: "ready"
3 项失败
```

即：修复前，任何一次重新读取（点击、聚焦、5 分钟轮询）都会让金额瞬间被「未登录」顶掉，直到响应返回——这正是报上来的现象。

**未验证**：浏览器里的实际渲染。请刷新 Web UI 目视确认。

**已知的滞后（无功能影响）**：`package.json` 的改动（如本次的 `dsh.client.inject` 成员、`locale/*.json`）会被宿主的插件清单缓存挡住，要**重启 App** 才反映到启动图的行上。这不影响渲染，因为余额座位由 `dsh-client-ui-sidebar` 声明，而该包仍在 inject 列表里。

## 如果刷新后没看到

在 GUI 页面按 F12 打开控制台，粘贴：

```js
console.log('boot row:', (window.__DSH_BOOT__?.entries ?? []).find((e) => e.id === '@local/dsh-wallet-hud'))
console.log('style tag:', !!document.querySelector('style[data-plugin-css="@local/dsh-wallet-hud/wallet-hud.css"]'))
console.log('balance chip:', document.querySelectorAll('.whud-chip').length)
console.log('cost pill (应为 0):', document.querySelectorAll('.whud-cost').length)
```

- `boot row` 有值 = 宿主已把插件发给页面；`undefined` = 宿主没编入启动图。
- `style tag: true` = 插件的 `apply()` 跑过了（说明服务依赖都满足）。
- `balance chip` ≥ 1 = 侧边栏余额已渲染。
- `cost pill: 0` = 会话消耗胶囊已彻底移除。

把输出附在 issue 里即可定位。
