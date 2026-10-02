# 更新日志

本项目的版本号与 git tag 一一对应（`vX.Y.Z`）。安装时钉 tag 即可钉住版本。

## 1.1.1

文档与元数据整理，无功能改动：

- README 重写为面向使用者的结构，新增英文版 `README.en.md`；
- 补充 `CHANGELOG.md` 与 `docs/implementation-notes.md`（实现笔记从 README 迁出）；
- `package.json` 补齐 `repository` / `homepage` / `bugs` / `keywords` / `author`，`files` 增加 `CHANGELOG.md` 与 `README.en.md`。

## 1.1.0

- 悬浮提示从原生 `title` 换成宿主自带的 `Tooltip` 原语：不再受"窗口未激活不弹"的影响，且跟随应用主题；
- 提示内容重排为三行——类别与金额同行、更新时间与操作提示合并成末行；
- 新增 `.whud-chip{height:100%}`，抵消 `Tooltip` 外层锚点 span 带来的 5px 上移；
- 渲染测试扩充到 21 项断言，并新增 `NO_PRIMITIVES=1` 的回落路径验证。

## 1.0.1

- 修复重新读取时金额瞬间退化成「未登录」的问题：刷新在途继续显示上一次的金额，只在提示里标注「查询中」；
- 新增 `test/render.test.mjs` 回归测试（`LEGACY=1` 可复现修复前的现象）。

## 1.0.0

- 首个版本：侧边栏底部（`sidebar.footer.action`）显示已登录账号的钱包余额，点击刷新；
- 三态渲染（未登录 / 金额 / 查询失败），失败不会显示成 `¥0.00`；
- 中英双语文案，MIT 许可证。
