# ADR-0002：保留官方 Plugin Inventory

状态：已接受。

## 决策

新增 `safe-plugin-manager` 设置标签，不使用官方 `all` 标签 ID，也不在 Bundle Patch
中禁用 `ui-settings-plugin-inventory`。

## 原因

官方清单是 DSH 自己的运行态权威视图。第三方管理器在尚未完全复现其语义时遮蔽它，
会让用户失去对照基准，也扩大插件故障的影响范围。

## 后果

首版会同时存在官方运行态清单和本项目声明/来源视图。后续可在 UI 中解释两者差异，
但不得以第三方视图替代官方权威状态。

