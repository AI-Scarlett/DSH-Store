#!/usr/bin/env node

import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import {
  LEGACY_REPAIR_ERROR, LEGACY_REPAIR_REPOSITORY, createLegacyRepairService,
} from '../src/legacy-repair.mjs'

function parseArgs(argv) {
  const options = { profile: 'web', targetCommit: null, targetVersion: null, planOnly: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--profile') options.profile = argv[++index]
    else if (argument === '--target-commit') options.targetCommit = argv[++index]
    else if (argument === '--target-version') options.targetVersion = argv[++index]
    else if (argument === '--plan-only') options.planOnly = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else throw Object.assign(new Error(`未知参数：${argument}`), { code: 'REPAIR_ARGUMENT_INVALID' })
  }
  return options
}

function printHelp() {
  stdout.write(`DSH STORE 历史版本安全修复器\n\n` +
    `用法：dsh-store-repair --profile web --target-version <version> --target-commit <40位Commit>\n\n` +
    `修复器只处理 ${LEGACY_REPAIR_ERROR} 更新阻断；不会执行第三方生命周期脚本，` +
    `不会修改 DSH 源码或 @deepseek-ai/* 官方包。\n`)
}

function printPlan(plan) {
  const blockers = plan.detectedLifecyclePackages.length > 0
    ? plan.detectedLifecyclePackages.map(item => `  - ${item.packageName} ${item.version ?? ''}: ${item.scripts.join(', ')}`).join('\n')
    : '  - 未发现；仍会禁止全部生命周期脚本'
  stdout.write(`\n安全修复计划\n` +
    `事务：${plan.transactionId}\n` +
    `Profile：${plan.profile}\n` +
    `商城：${plan.current.version} → ${plan.target.version}\n` +
    `固定 Commit：${plan.target.commit}\n` +
    `官方仓库：${plan.target.repositoryUrl}\n` +
    `脚本策略：禁止全部 preinstall/install/postinstall/prepare\n` +
    `检测到的 Git 生命周期包：\n${blockers}\n` +
    `备份：${plan.impact.backupDirectory}\n` +
    `重启：${plan.impact.restart === 'guardian-verified' ? '由 Guardian 请求并验证新 Boot' : '更新后需要用户自行安全重启'}\n` +
    `不会修改：${plan.impact.neverModify.join('；')}\n\n` +
    `确认语：${plan.confirmation}\n`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) return printHelp()
  if (!options.targetCommit || !options.targetVersion) {
    throw Object.assign(new Error('缺少 --target-version 或 --target-commit；请从 DSH STORE 官方修复页复制完整命令。'), { code: 'REPAIR_ARGUMENT_INVALID' })
  }
  const service = createLegacyRepairService()
  const plan = await service.createPlan({
    profile: options.profile,
    target: { repositoryUrl: LEGACY_REPAIR_REPOSITORY, version: options.targetVersion, commit: options.targetCommit },
  })
  printPlan(plan)
  if (options.planOnly) {
    stdout.write('\n只读计划已完成，未修改 Profile。\n')
    return
  }
  if (!stdin.isTTY || !stdout.isTTY) throw Object.assign(new Error('真实修复必须在交互式终端中确认。'), { code: 'REPAIR_TTY_REQUIRED' })
  const terminal = createInterface({ input: stdin, output: stdout })
  const confirmation = await terminal.question('\n请输入完整确认语后按回车（直接回车取消）：')
  terminal.close()
  if (confirmation !== plan.confirmation) {
    stdout.write('确认语不匹配，未修改 Profile。\n')
    process.exitCode = 2
    return
  }
  const result = await service.execute({ planId: plan.planId, confirmation })
  if (result.status === 'applied-runtime-verified') {
    stdout.write(`\n修复完成：商城 ${result.targetVersion} 已安装，Guardian 已验证新 Boot。\n`)
    return
  }
  if (result.status === 'applied-restart-required') {
    stdout.write(`\n商城 ${result.targetVersion} 已安装并通过配置检查，但 Guardian 不可用；请按官方页面执行安全重启并重新检查版本。\n`)
    process.exitCode = 3
    return
  }
  if (result.status === 'applied-restart-unverified') {
    stdout.write('\n更新已写入，但 Guardian 尚未在时限内完成运行验收；不要启动第二个 DSH，请保留事务编号并查看 Guardian 状态。\n')
    process.exitCode = 4
    return
  }
  stdout.write(`\n修复未完成，Profile 已进入回滚流程。事务：${result.transactionId}；状态：${result.rollback ?? result.status}\n`)
  process.exitCode = 1
}

main().catch(error => {
  stdout.write(`\n修复器已安全停止：${error?.code ?? 'REPAIR_FAILED'}：${String(error?.message ?? error)}\n`)
  process.exitCode = 1
})
