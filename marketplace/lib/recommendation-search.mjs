const STOP_WORDS = new Set([
  "i", "me", "my", "we", "our", "you", "your", "the", "a", "an", "to", "for", "of", "in", "on", "with", "and", "or", "can", "could", "would", "should", "please", "what", "which", "how", "want", "need", "use", "using",
  "dsh", "deepseek", "harness", "plugin", "plugins", "tool", "tools", "feature", "features", "experimental", "experiment", "new",
  "我", "我需", "需要", "我想", "想要", "请问", "如何", "怎么", "怎样", "可以", "能否", "能不能", "能读", "能看", "一下", "这个", "那个", "满足", "需求", "要用", "用什", "什么", "么插", "插件", "插件助手", "实验", "验功", "功能", "能插", "新功能", "新锐实验", "实验功能", "实验功能插件", "工具", "工具能力", "能力", "dsh插件", "deepseek插件",
])

const IMAGE_QUERY = /图片|图像|照片|截图|\bscreenshots?\b|\bimages?\b|\bpictures?\b|\bphotos?\b|\bvision\b|\bvisual\b|\bocr\b|识图|多模态/i
const IMAGE_READ_QUERY = /读取|读图|识图|识别|理解|看图|看懂|提取.{0,8}(?:图片|图像|文字)|\bread(?:ing)?\b|\brecogn(?:ize|ition|izing)\b|\bunderstand(?:ing)?\b|\bocr\b|\bvision\b/i
const IMAGE_GENERATE_QUERY = /生成|生图|画图|绘图|作画|\bimage\s*gen(?:eration)?\b|\bgenerate(?:d|s|ing)?\s+(?:an?\s+)?images?\b|\bdraw(?:ing)?\s+(?:an?\s+)?images?\b/i
const IMAGE_GENERATION_EVIDENCE = /图像生成|图片生成|生成图片|生图|绘图|作画|\bimage[-\s]?gen(?:eration)?\b|\bimagegen\b|\btext[-\s]?to[-\s]?image\b|\bimage generator\b/i
const IMAGE_READING_EVIDENCE = /视觉|识图|图像识别|图片识别|图像理解|图片理解|多模态|\bvision\b|\bvisual\b|\bocr\b|\bimages? into text\b|\bread(?:s|ing)? images?\b|\bimage understanding\b/i
const IMAGE_READING_SYNONYMS = ["图片", "图像", "视觉", "识图", "识别", "读图", "vision", "visual", "image", "images", "多模态"]

function splitSearchTokens(value) {
  const text = String(value || "").toLowerCase()
  const segments = text.match(/[a-z0-9]+(?:[-_.][a-z0-9]+)*|[\u3400-\u9fff]+/g) || []
  const tokens = new Set()

  for (const segment of segments) {
    if (/[\u3400-\u9fff]/.test(segment)) {
      for (let index = 0; index < segment.length - 1; index += 1) {
        const token = segment.slice(index, index + 2)
        if (!STOP_WORDS.has(token)) tokens.add(token)
      }
      continue
    }

    if (!STOP_WORDS.has(segment)) tokens.add(segment)
    for (const part of segment.split(/[-_.]+/)) {
      if (part.length > 1 && !STOP_WORDS.has(part)) tokens.add(part)
    }
  }

  return tokens
}

export function tokenize(text) {
  return [...splitSearchTokens(text)]
}

function entryFields(entry) {
  const packageName = entry.packageName || entry.name || entry.id || ""
  return {
    identity: [packageName, entry.displayName, entry.name, entry.nameZh, entry.nameEn, entry.alias].filter(Boolean).join(" "),
    terms: Array.isArray(entry.searchTerms) ? entry.searchTerms.join(" ") : "",
    description: entry.description || "",
    categories: Array.isArray(entry.categories) ? entry.categories.join(" ") : "",
    all: [
      packageName,
      entry.displayName,
      entry.name,
      entry.nameZh,
      entry.nameEn,
      entry.alias,
      entry.description,
      ...(Array.isArray(entry.searchTerms) ? entry.searchTerms : []),
      ...(Array.isArray(entry.categories) ? entry.categories : []),
    ].filter(Boolean).join(" "),
  }
}

function isInstallable(entry) {
  return entry.status === "approved" && /^[a-f0-9]{40}$/i.test(String(entry.commit || ""))
}

function queryTokens(queryText) {
  const tokens = splitSearchTokens(queryText)
  const normalized = String(queryText || "").toLowerCase()
  if (IMAGE_QUERY.test(normalized) && IMAGE_READ_QUERY.test(normalized) && !IMAGE_GENERATE_QUERY.test(normalized)) {
    for (const token of IMAGE_READING_SYNONYMS) tokens.add(token)
  }
  return tokens
}

export function searchTokens(queryText) {
  return [...queryTokens(queryText)]
}

function imageIntentAllowsEntry(queryText, fields) {
  const normalized = String(queryText || "").toLowerCase()
  const isImageRequest = IMAGE_QUERY.test(normalized) || IMAGE_GENERATE_QUERY.test(normalized)
  if (!isImageRequest) return true

  const isReadRequest = IMAGE_READ_QUERY.test(normalized)
  const isGenerateRequest = IMAGE_GENERATE_QUERY.test(normalized)
  if (!isReadRequest && !isGenerateRequest) return true

  const hasGenerationEvidence = IMAGE_GENERATION_EVIDENCE.test(fields.all)
  const hasReadingEvidence = IMAGE_READING_EVIDENCE.test(fields.all)
  if (isReadRequest && !isGenerateRequest && !hasReadingEvidence) return false
  if (isGenerateRequest && !isReadRequest && !hasGenerationEvidence) return false
  return true
}

export function searchCatalogCandidates(queryText, catalog, limit = 8) {
  if (!Array.isArray(catalog) || catalog.length === 0 || !Number.isInteger(limit) || limit < 1) return []

  const qTokens = queryTokens(queryText)
  if (qTokens.size === 0) return []

  const scored = []
  for (const entry of catalog) {
    if (!isInstallable(entry)) continue
    const fields = entryFields(entry)
    if (!imageIntentAllowsEntry(queryText, fields)) continue

    const identityTokens = splitSearchTokens(fields.identity)
    const termTokens = splitSearchTokens(fields.terms)
    const descriptionTokens = splitSearchTokens(fields.description)
    const categoryTokens = splitSearchTokens(fields.categories)
    let score = 0
    let matchedTerms = 0

    for (const token of qTokens) {
      if (identityTokens.has(token)) {
        score += 10
        matchedTerms += 1
      } else if (termTokens.has(token)) {
        score += 7
        matchedTerms += 1
      } else if (descriptionTokens.has(token)) {
        score += 3
        matchedTerms += 1
      } else if (categoryTokens.has(token)) {
        score += 1
        matchedTerms += 1
      }
    }

    if (matchedTerms === 0) continue
    if (entry.stars > 0) score += Math.min(1, Math.log2(entry.stars + 1) / 10)
    scored.push({ entry, score, matchedTerms })
  }

  return scored
    .sort((a, b) => b.score - a.score || b.matchedTerms - a.matchedTerms || String(a.entry.packageName || a.entry.name).localeCompare(String(b.entry.packageName || b.entry.name)))
    .slice(0, limit)
    .map(item => item.entry)
}
