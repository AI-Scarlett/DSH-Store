import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { assertCatalogLocalization, localizeCatalogEntry, relocalizeCatalogEntries } from '../src/catalog-localization.mjs'
import { loadCatalogFromFiles, searchCatalog } from '../src/catalog.mjs'

test('localization creates durable Chinese names, descriptions, and search aliases', () => {
  const localized = localizeCatalogEntry({
    id: 'dsh-task-notify', packageName: '@example/dsh-task-notify', name: 'dsh-task-notify',
    description: 'Sends a desktop notification when a task finishes.', categories: ['notifications'],
  }, { notifications: '通知与集成' })
  assert.equal(localized.name, '任务通知提醒（DSH Task Notify）')
  assert.match(localized.description, /为 DSH 提供任务通知提醒能力/)
  assert.ok(localized.searchTerms.includes('任务完成'))
  assert.ok(localized.searchTerms.includes('@example/dsh-task-notify'))
})

test('localization preserves a curated Chinese-English display name', () => {
  const localized = localizeCatalogEntry({
    id: 'demo', packageName: 'dsh-demo', name: '演示助手（Demo Assistant）',
    description: '这是供用户理解的中文说明。', categories: ['tools'],
  })
  assert.equal(localized.name, '演示助手（Demo Assistant）')
  assert.equal(localized.description, '这是供用户理解的中文说明。')
})

test('Sage Mem keeps its file-based cross-session memory identity ahead of migration aliases', () => {
  const entry = {
    id: 'sage-mem', packageName: 'sage-mem', name: '配置导入迁移（Sage Mem）',
    description: '基于文件的跨会话记忆：纯 Markdown 记忆文件。', categories: ['memory'],
    searchTerms: ['配置导入迁移', 'Sage Mem', 'sage-mem', '配置迁移', '记忆'],
  }
  const localized = localizeCatalogEntry(entry)
  assert.equal(localized.name, '文件式跨会话记忆（Sage Mem）')
  assert.deepEqual(localized.searchTerms.slice(0, 4), [
    '文件式跨会话记忆', '记忆', '跨会话记忆', 'Sage Mem',
  ])
  assert.ok(localized.searchTerms.indexOf('记忆') < localized.searchTerms.indexOf('配置迁移'))
  assert.ok(localized.searchTerms.indexOf('跨会话记忆') < localized.searchTerms.indexOf('配置迁移'))
})

test('catalog localization refresh reports stale persisted display metadata', () => {
  const sageMem = {
    id: 'sage-mem', packageName: 'sage-mem', name: '配置导入迁移（Sage Mem）',
    description: '基于文件的跨会话记忆：纯 Markdown 记忆文件。', categories: ['memory'],
    searchTerms: ['配置导入迁移', 'Sage Mem', 'sage-mem', '配置迁移', '记忆'],
  }
  const unrelated = {
    id: 'demo', packageName: 'demo', name: '人工策划（Demo）',
    description: '手工整理的介绍。', searchTerms: ['自定义排序'],
  }
  const result = relocalizeCatalogEntries([sageMem, unrelated])
  assert.equal(result.entries[0].name, '文件式跨会话记忆（Sage Mem）')
  assert.match(result.entries[0].description, /透明 Markdown 文件/)
  assert.match(result.entries[0].description, /记忆星图/)
  assert.equal(result.entries[1], unrelated)
  assert.deepEqual(result.changes, [{
    id: 'sage-mem', fromName: '配置导入迁移（Sage Mem）', toName: '文件式跨会话记忆（Sage Mem）',
  }])
})

test('the production Catalog is fully localized and searchable by Chinese use cases', async () => {
  const catalog = await loadCatalogFromFiles()
  assertCatalogLocalization(catalog)
  const refresh = relocalizeCatalogEntries(catalog.entries, catalog.registry.categories)
  const sageMem = refresh.entries.find(entry => entry.id === 'sage-mem')
  assert.equal(sageMem.name, '文件式跨会话记忆（Sage Mem）')
  assert.deepEqual(
    relocalizeCatalogEntries(refresh.entries, catalog.registry.categories).changes,
    [],
    'a localized production Catalog must stay stable on the next refresh',
  )
  assert.ok(searchCatalog(catalog, '任务完成', { includeUnlisted: true }).some(entry => entry.id === 'dsh-task-notify'))
  assert.ok(searchCatalog(catalog, '余额', { includeUnlisted: true }).some(entry => entry.id === 'dsh-balance-monitor'))
  assert.ok(catalog.entries.every(entry => entry.searchTerms.some(term => /[\u3400-\u9fff]/u.test(term))))
})
