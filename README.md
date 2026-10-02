# Wallet HUD · 钱包余额

在 **DeepSeek Harness** Web UI 的侧边栏底部显示已登录账号的钱包余额。

**简体中文** | [English](README.en.md)

## 功能特性

- **一处座位**：侧边栏底部、设置按钮旁显示余额，点击即刷新；侧边栏折叠成图标导轨时自动改用居中的窄版。
- **三态清晰**：未登录 / 查询中 / 查询失败各有文案，**任何失败都不会伪装成 `¥0.00`**。
- **刷新在途不闪**：重新读取期间继续显示上一次的金额，只在提示里标注「查询中」，不会退化成「未登录」。
- **应用风格悬浮提示**：用宿主自带的 `Tooltip` 原语，列出充值余额、赠送余额与更新时间。
- **中英双语**：文案走 `ctx.locale`，zh / en 双字典，键集以中文为准。
- **零构建**：手写 lazy-CJS bundle，`git clone` 下来即可安装，没有打包步骤，也没有运行时依赖。

## 界面位置

| 位置 | 槽位 | 内容 |
|---|---|---|
| 侧边栏底部（设置按钮旁） | `sidebar.footer.action` | 已登录账号的钱包余额，点击刷新 |

## 环境要求

- DeepSeek Harness，且当前组合提供账户服务（Web / desktop 组合自带）。
- 余额来自宿主已有的 `account.getBalance` Remote，**本插件不新增任何 Host 接口**，host 半边是空实现。
- 无需构建工具；Node.js 只用于跑仓库自带的回归测试。

## 安装

本包同时是一个 **bundle**（host 行）和一个 **client 插件**（浏览器 bundle），安装交给插件管理器：它会调用 pnpm 把包装进 profile，并把本包登记为一个 bundle 层。

**不要手写 profile 的 `package.json` / `cordis.patch.yml`，也不要在 profile 目录里跑 pnpm** —— 那是官方文档明确排除的做法。

### 方式 A：直接从 GitHub 安装（推荐）

```sh
plugin_manager action=install_bundle target=github:gggtmd/dsh-wallet-hud
```

图形界面等价：**设置 → 插件 → 安装**，输入框里填同一个 spec。

pnpm 会把仓库拉成 `node_modules/.pnpm` 里的版本化副本，所以**安装后不需要保留源码目录**；升级时重新执行一次即可。

### 方式 B：克隆到本地再安装

```sh
git clone https://github.com/gggtmd/dsh-wallet-hud ~/dsh-plugins/dsh-wallet-hud
plugin_manager action=install_bundle target=~/dsh-plugins/dsh-wallet-hud
```

这种装法是 `link:` 软链接，**插件本体就是那个目录**：`git pull` 即为升级（宿主会按文件 mtime 重新打包该 bundle）。反过来，删掉目录插件就失效——想与源码解耦就用方式 A 或 C。

### 方式 C：Release tarball，或发布到 npm 之后的包名

```sh
plugin_manager action=install_bundle target=https://github.com/gggtmd/dsh-wallet-hud/archive/refs/tags/v1.1.1.tar.gz
```

宿主对 `target` 的处理就是 `pnpm add <spec>`，凡是 pnpm 认的 spec 都能用。

| 安装方式 | 落到机器上的是什么 | 升级方式 |
|---|---|---|
| A / C 仓库或 tarball | `node_modules/.pnpm` 里的**版本化副本** | 重新执行 `install_bundle` |
| B 本地目录 / clone | `link:` 软链接，**插件本体就是该目录** | `git pull` |

### 停用与卸载

```sh
# 临时停用（保留安装）
plugin_manager action=set_plugin target=@local/dsh-wallet-hud enabled=false

# 卸载
plugin_manager action=remove_bundle target=@local/dsh-wallet-hud
```

### 生效时机

- 装好后刷新 Web UI 页面即可看到；
- 之后改 `client.js`（浏览器半边）只需**刷新页面**——宿主会重新生成该 bundle 的版本号；
- 改 `index.js`（host 半边）、`package.json` 或 `locale/*.json` 需要**重启 App**，因为宿主会缓存插件清单。

## 使用

侧边栏底部的胶囊显示当前余额；鼠标悬浮出提示：

```
充值余额  ¥1.99
赠送余额  ¥5.00
更新于 17:09:03 · 点击刷新
```

第二行只在账号确实有赠送余额时出现。未登录或查询失败时，胶囊显示对应占位文案，提示里给出原因。

刷新时机：**挂载时 + 窗口重新聚焦或切回前台时 + 每 5 分钟一次 + 手动点击**。同一时刻只保留一个在途请求。轮询仅在页面可见时进行——该接口每次都真实访问 Platform，没有缓存也没有限流，所以刻意保持低频。

## 工作原理

### 数据来源

复用账户子系统已有的 Remote：

```js
ctx.remote.account.getBalance({ version, locale, timezoneOffsetSeconds })
// → null                                           未登录 / 凭据换代
// → { status: 'ready', value: [{ currency, balance }], bonusWallets: [...] }
// → { status: 'failed' }                            查询失败，可重试
```

`version` / `locale` / `timezoneOffsetSeconds` 每次调用时现取，因为宿主会把请求方 UI 的语言和时区报给 Platform。币种取钱包自己上报的币种（优先有正余额的钱包），暂时取不到时按 `CNY` 显示。

### 渲染不变量

三种状态映射到三套文案与 `data-state`：`ready` / `absent`（未登录）/ `failed`。**失败永远不显示成金额**，刷新在途也不会把上一次的金额撤下——退化成「未登录」会让用户以为掉了登录态（1.0.1 修的就是这个，见 [CHANGELOG](CHANGELOG.md)）。

`ctx.get('remote.account')` 暂时取不到时按「组合尚未装配」处理：每 3 秒重试，连续 5 次才显示「当前组合未提供账户服务」。

### 悬浮提示

用官方 `Tooltip` 原语（`@deepseek-ai/dsh-client-ui-primitives`）而不是 `title` 属性：原生 `title` 由系统绘制，窗口未激活时不弹（表现为"要先点一下窗口才显示"），而且无法排版、无法跟随主题。气泡是 DOM 里的真实元素，只受鼠标事件驱动。

气泡样式是 `white-space: pre-line`，所以**换行会保留**，`label` 传多行字符串即可；但连续普通空格会被折叠，因此类别与金额的对齐用**不换行空格** `\u00a0`。参数为 `side: 'top'`、`portal: true`（挂到 `document.body`，免受侧边栏祖先的裁剪与层叠上下文影响）、`maxWidth: 280`。

`ui-primitives` 是**基线模块**而不是可注入的 client 条目，所以它不需要（也不应该）列进 `dsh.client.inject`——官方 `ui-settings-account` 等包同样直接 `require` 它。取不到 `Tooltip` 时插件退回原生 `title` 气泡，不会整块挂掉。

### 依赖的宿主契约

- 槽位 `sidebar.footer.action`（list 槽位，owner 传 `{ wide }`）；
- `ctx.slots.inject(...)` / `ctx.slots.register(...)`；
- `ctx.locale` 绑定 `t`，`inject: () => ({ ... })` 注入 props；
- `remoteServiceKey(namespace) === 'remote.' + namespace`，即 `ctx.get('remote.account')` 成立。

## 兼容性

- `client.js` 顶部的 `CLIENT_VERSION`（当前 `0.2.0-rc.2`）会作为 `version` 一并报给 Platform 的账户接口。宿主客户端大版本变化后若余额查询被服务端拒绝，同步改这里。
- UI 只使用 `--dsw-alias-*` 主题 token，跟随应用深浅色，不 import 任何 Harness 客户端包。
- 浏览器半边只 `require` 两个基线模块：`react` 与 `@deepseek-ai/dsh-client-ui-primitives`。

## 开发

```
package.json         包清单：dsh.bundle.patch + dsh.client(platform:web, immediately:true)
cordis.patch.yml     bundle 补丁：insert 一行 wallet-hud
index.js             host 半边，空 apply()（必须存在，供 Loader import）
client.js            浏览器 bundle（手写 lazy-CJS 格式）
locale/{zh,en}.json  插件管理器卡片文案
test/render.test.mjs 渲染回归测试
docs/              实现笔记（bundle 格式、宿主内部契约、验证记录）
```

`client.js` 是手写的、不经构建的 bundle，格式与官方模板一致：

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-wallet-hud',   // 必须等于包名
  factory(require) { /* … */ return { inject: [...], apply(ctx) { /* … */ } } },
})
```

加载器取的是**工厂的返回值**作为 `exports`；`client.js` 里的每个 `require()` 都必须落在浏览器基线模块表内（react、react/jsx-runtime、react-dom、cordis、dsh-client-store、dsh-client-ui-slots、dsh-client-ui-primitives、dsh-client-ui-dockkit）。细节见 [docs/implementation-notes.md](docs/implementation-notes.md)。

### 测试

```sh
npm test                  # 21 项断言，全部通过
LEGACY=1 npm test         # 在内存里还原 1.0.0 的写法，复现「未登录」闪烁（3 项失败）
NO_PRIMITIVES=1 npm test  # 模拟没有 Tooltip 原语的组合，验证回落到原生 title
```

测试不复制组件逻辑，而是从 bundle 里**捕获 `ctx.slots.register` 收到的组件本体**再真实渲染，用可控的 `getBalance` promise 驱动六个阶段。

### 调试

刷新后没看到胶囊时，在 Web UI 按 F12 打开控制台：

```js
console.log('boot row:', (window.__DSH_BOOT__?.entries ?? []).find((e) => e.id === '@local/dsh-wallet-hud'))
console.log('style tag:', !!document.querySelector('style[data-plugin-css="@local/dsh-wallet-hud/wallet-hud.css"]'))
console.log('balance chip:', document.querySelectorAll('.whud-chip').length)
```

`boot row` 有值 = 宿主已把插件编入启动图；`style tag: true` = `apply()` 跑过、服务依赖都满足；`balance chip ≥ 1` = 胶囊已渲染。

### 发版

1. 改 `package.json` 的 `version`；
2. `npm test` 全绿；
3. `git commit` + `git tag -a vX.Y.Z` + `git push origin main && git push origin vX.Y.Z`；
4. 在 GitHub Releases 里为 tag 写说明（内容与 [CHANGELOG](CHANGELOG.md) 对应）。

使用者只能靠 tag 钉住版本，所以改代码时务必同步改 `version` 并打同号 tag。

## 常见问题

**胶囊显示「未登录」，但我明明是登录状态？**
先确认账户服务在线：卡片式账户页能正常显示即说明 Remote 可用。若只有本插件异常，把上面「调试」的输出附到 issue 里。

**显示「当前组合未提供账户服务」？**
当前 DSH 组合没有提供 `account` Remote（例如精简组合）。这不是插件故障，换成 Web / desktop 组合即可。

**金额和账户页对不上？**
余额没有缓存，任何一次读取都是实时请求；差异通常是两次读取之间发生了消费。点一下胶囊即可强制刷新。

**侧边栏折叠后胶囊变成一个小图标？**
槽位 owner 在导轨状态下传 `{ wide: false }`，胶囊会隐藏文字只留金额并居中，这是预期行为。

## 贡献

欢迎 issue 与 PR。改动请附带 `npm test` 的输出；涉及浏览器半边的改动，请说明是用哪种方式目视验证的。

## 许可证

[MIT](LICENSE) © 2026 gggtmd
