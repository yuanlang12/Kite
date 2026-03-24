---
name: release
description: 发布新版本：bump 版本号、创建 git tag、推送到远程
disable-model-invocation: true
---

发布流程：

1. 读取当前 `package.json` 中的 version
2. 询问用户要发布的版本类型：patch / minor / major，或让用户指定具体版本号（通过 $ARGUMENTS 传入，如 `/release patch`）
3. 更新根 `package.json` 的 version 字段
4. 运行 `bun typecheck` 确保类型检查通过
5. 创建 git commit：`chore: release v<version>`
6. 创建 git tag：`v<version>`
7. 推送 commit 和 tag：`git push && git push --tags`
8. 显示发布摘要
