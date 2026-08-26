import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const project = new URL('../', import.meta.url)

const wiki = async name => readFile(new URL(`docs/wiki/${name}`, project), 'utf8')

test('Wiki publishes and navigates to the incident-response encyclopedia', async () => {
  const [home, sidebar, faq, incident] = await Promise.all([
    wiki('Home.md'),
    wiki('_Sidebar.md'),
    wiki('FAQ.md'),
    wiki('Incident-Response.md'),
  ])
  assert.match(home, /故障应急百科/)
  assert.match(sidebar, /\[故障应急百科\]\(Incident-Response\)/)
  assert.match(faq, /故障应急百科/)
  assert.match(incident, /^# 故障应急百科/m)
  assert.match(incident, /GitHub Raw Catalog、GitHub Pages、国际站、国内站和真实 Profile 是不同表面/)
})

test('Wiki incident guidance preserves the guarded lifecycle boundary', async () => {
  const incident = await wiki('Incident-Response.md')
  assert.match(incident, /不手改 Profile/)
  assert.match(incident, /官方 `dsh` CLI/)
  assert.match(incident, /未知不是通过/)
  assert.match(incident, /Loader、Fiber 或私有模块 API/)
  assert.match(incident, /固定来源、文件哈希、备份、回滚和健康检查/)
  assert.doesNotMatch(incident, /AI-Scarlett\/dsh-safe-plugin-manager/i)
})
