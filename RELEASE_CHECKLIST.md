# Quiet Workbench 0.6.x 发布清单

这份清单用于发布前人工确认。`pnpm release:verify` 只检查源码、构建和发布文件，
不会提交、推送、创建 GitHub Release，也不会写入任何 Obsidian Vault。

## 自动检查

```bash
pnpm install --frozen-lockfile
pnpm release:verify
```

自动检查会确认：

- Node.js 22 LTS / pnpm 10 环境可用。
- TypeScript、Vitest、ESLint 和生产构建全部通过。
- `package.json`、`manifest.json` 和 `versions.json` 版本一致。
- `manifest.isDesktopOnly` 仍为 `false`。
- `README.md`、`LICENSE`、`manifest.json`、`main.js` 和 `styles.css` 均存在。
- GitHub Release tag 没有 `v` 前缀，并且与 `manifest.version` 完全一致。

## 人工验收

- [ ] 在虚构测试 Vault 中重启 Obsidian，确认首次扫描只读且索引能恢复。
- [ ] 桌面端浅色、深色主题检查今日焦点、任务看板、任务日历和项目组件。
- [ ] 移动端检查单列排序、折叠、隐藏、触摸滚动和键盘弹出后的布局。
- [ ] 在两个设备/两个 Obsidian 窗口中分别修改同一 Markdown，确认过期写入被拒绝。
- [ ] 外部修改后尝试撤销，确认插件保留外部内容并给出冲突提示。
- [ ] 会议行动批量迁移的重复运行、部分失败和恢复流程通过。
- [ ] 真实 Vault 只读诊断通过；确认模板、旧 Workbench 页面和业务 Markdown 未被批量改写。

## GitHub 发布

1. 确认工作区只包含本次发布内容并人工查看 `git diff`。
2. 提交并推送源码到 GitHub。
3. 创建与 `manifest.version` 完全一致的 Release，例如 `0.6.0`，不要使用 `v0.6.0`。
4. 上传 `main.js`、`manifest.json` 和 `styles.css`；README 和 LICENSE 保留在仓库根目录。
5. 使用 BRAT 或手动复制附件到测试 Vault，再进行一次安装验证。
6. 个人私用不需要 Obsidian 审批；申请社区目录前需另行完成官方审核要求。

## 回退

- 保留上一版本 Release 附件。
- 保留正式 Vault 的 `.obsidian/plugins/quiet-workbench/data.json` 和布局设置。
- 若新版本异常，禁用插件并恢复上一版本的 `main.js`、`manifest.json`、`styles.css`；不删除业务 Markdown。
