# Pi 版本与许可

验证日期：2026-08-20。

## 固定基线

| 项目 | 固定值 |
| --- | --- |
| 上游仓库 | `https://github.com/earendil-works/pi` |
| Tag | `v0.84.2` |
| npm 包 | `@earendil-works/pi-coding-agent` |
| 包版本 | `0.84.2`（精确锁定） |
| 许可证 | MIT |
| Pi 最低 Node | `>=22.19.0` |
| Margin 固定 runtime | `22.23.1` |

`package.json` 与 `package-lock.json` 必须精确记录 0.84.2，不接受范围版本。`.runtime/` 只保存本地开发 runtime，并由 Git 忽略。

## 证据链接

- [Pi 上游仓库](https://github.com/earendil-works/pi)
- [v0.84.2 coding-agent package manifest](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/package.json)
- [v0.84.2 MIT LICENSE](https://github.com/earendil-works/pi/blob/v0.84.2/LICENSE)
- [SDK 文档](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/docs/sdk.md)
- [RPC 文档](https://github.com/earendil-works/pi/blob/v0.84.2/packages/coding-agent/docs/rpc.md)

本地 `npm run audit:pi` 同时核对当前 Node、依赖声明、已安装包版本、已安装包 license 字段和固定 runtime 是否存在。只有全部匹配时退出 0。

## 许可使用边界

MIT 允许使用、修改和再分发，但分发时需要保留版权和许可声明。Margin 必须清楚归因，不能把 Pi 原生 Agent loop、工具生命周期、Session、分支或上下文压缩描述为个人从零实现。
