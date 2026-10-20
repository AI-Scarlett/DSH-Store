const BEIJING_TIME_ZONE = 'Asia/Shanghai'
const MAX_SOURCE_AGE_MS = 45 * 60 * 1000
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isTimestamp(value) {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value))
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function beijingDate(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function lastSevenDates(today) {
  const end = new Date(`${today}T00:00:00Z`)
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(end)
    day.setUTCDate(end.getUTCDate() - 6 + index)
    return day.toISOString().slice(0, 10)
  })
}

export function normalizePublicTrafficSnapshot(value, now = new Date()) {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.site !== 'dsh-store-cn'
    || value.timeZone !== BEIJING_TIME_ZONE
    || !isTimestamp(value.generatedAt)
    || !isTimestamp(value.sourceUpdatedAt)
    || typeof value.fresh !== 'boolean'
    || !isDate(value.today?.date)
    || !isCount(value.today?.pv)
    || !isCount(value.today?.uv)
    || !Array.isArray(value.days)
    || value.days.length !== 7) return null

  const today = beijingDate(now)
  const expectedDates = lastSevenDates(today)
  const days = []
  for (let index = 0; index < expectedDates.length; index++) {
    const item = value.days[index]
    if (!isRecord(item)
      || item.date !== expectedDates[index]
      || !isCount(item.pv)
      || !isCount(item.uv)) return null
    days.push({ date: item.date, pv: item.pv, uv: item.uv })
  }

  const generatedAt = Date.parse(value.generatedAt)
  const sourceUpdatedAt = Date.parse(value.sourceUpdatedAt)
  const nowMs = now.getTime()
  const withinFreshnessWindow = [generatedAt, sourceUpdatedAt].every(timestamp => {
    const age = nowMs - timestamp
    return age >= -MAX_CLOCK_SKEW_MS && age <= MAX_SOURCE_AGE_MS
  })
  const fresh = value.fresh && withinFreshnessWindow && value.today.date === today
  const latest = days.at(-1)
  if (value.today.date !== latest.date || value.today.pv !== latest.pv || value.today.uv !== latest.uv) return null

  return {
    generatedAt: value.generatedAt,
    sourceUpdatedAt: value.sourceUpdatedAt,
    fresh,
    today: fresh ? { ...latest } : null,
    days,
  }
}
