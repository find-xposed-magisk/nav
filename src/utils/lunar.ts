// 开源项目，未经作者同意，不得以抄袭/复制代码/修改源代码版权信息。
// Copyright @ 2018-present xiejiahe. All rights reserved.
// See https://github.com/liuzi6612/nav

/**
 * 春节（农历正月初一）日期推算。
 * Spring Festival (lunar new year day) resolution.
 *
 * 设计取舍 / Design note:
 * 1. 内置 2020-2040 的表作为主数据源，因为 ICU 的 chinese 日历在部分版本上对个别年份
 *    存在 1 天偏差（本机 Node v24 实测 2027 年给出 02-07，时宪历为 02-06）。
 * 2. 超出表范围时退回 Intl 推算，扫描未来 400 天找「正月 + 初一」；
 *    ICU data differs from the official calendar for a few years, so the table wins
 *    whenever it covers the year, and Intl is only a fallback for outlier years.
 */

interface ISpringFestivalEntry {
  year: number
  date: string
}

const SPRING_FESTIVAL_TABLE: ISpringFestivalEntry[] = [
  { year: 2020, date: '2020-01-25' },
  { year: 2021, date: '2021-02-12' },
  { year: 2022, date: '2022-02-01' },
  { year: 2023, date: '2023-01-22' },
  { year: 2024, date: '2024-02-10' },
  { year: 2025, date: '2025-01-29' },
  { year: 2026, date: '2026-02-17' },
  { year: 2027, date: '2027-02-06' },
  { year: 2028, date: '2028-01-26' },
  { year: 2029, date: '2029-02-13' },
  { year: 2030, date: '2030-02-03' },
  { year: 2031, date: '2031-01-23' },
  { year: 2032, date: '2032-02-11' },
  { year: 2033, date: '2033-01-31' },
  { year: 2034, date: '2034-02-19' },
  { year: 2035, date: '2035-02-08' },
  { year: 2036, date: '2036-01-28' },
  { year: 2037, date: '2037-02-15' },
  { year: 2038, date: '2038-02-04' },
  { year: 2039, date: '2039-01-24' },
  { year: 2040, date: '2040-02-12' },
]

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86400000

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseYmd(s: string): Date | null {
  const m = YMD_RE.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return isNaN(d.getTime()) ? null : d
}

// 把任意输入规整为「当天零点」的 YYYY-MM-DD，规避时分秒带来的跨天误差
function normalizeDay(input: string | Date): string | null {
  if (input instanceof Date) {
    if (isNaN(input.getTime())) return null
    return toYmd(input)
  }
  if (typeof input !== 'string') return null
  const parsed = parseYmd(input.trim())
  if (parsed) return toYmd(parsed)
  const fallback = new Date(input)
  return isNaN(fallback.getTime()) ? null : toYmd(fallback)
}

function lookupTable(year: number): string | null {
  const hit = SPRING_FESTIVAL_TABLE.find((item) => item.year === year)
  return hit ? hit.date : null
}

/**
 * 用 Intl 的 chinese 日历扫描未来窗口，找到下一个正月初一。
 * Scan forward with the ICU chinese calendar until a 正月/初一 pair appears.
 */
function probeWithIntl(fromYmd: string, maxDays = 400): string | null {
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    })
  } catch {
    return null
  }

  const start = parseYmd(fromYmd)
  if (!start) return null

  for (let i = 0; i <= maxDays; i++) {
    const d = new Date(start.getTime() + i * DAY_MS)
    let parts: Intl.DateTimeFormatPart[]
    try {
      parts = fmt.formatToParts(d)
    } catch {
      return null
    }
    const month = parts.find((p) => p.type === 'month')?.value || ''
    const day = parts.find((p) => p.type === 'day')?.value || ''
    if (month === '正月' && day === '1') {
      return toYmd(d)
    }
  }
  return null
}

/**
 * 给定「今天」，返回下一次春节的公历日期（含当天）。
 * Returns the next Spring Festival date (today included if it happens to be the day).
 */
export function getNextSpringFestival(today: string | Date = new Date()): string {
  const todayYmd = normalizeDay(today)
  if (!todayYmd) return lookupTable(new Date().getFullYear() + 1) || ''

  const year = Number(todayYmd.slice(0, 4))

  // 先看表：当年、次年
  const sameYear = lookupTable(year)
  if (sameYear && sameYear >= todayYmd) return sameYear
  const nextYear = lookupTable(year + 1)
  if (nextYear) return nextYear

  // 表未覆盖，退回 Intl
  const probed = probeWithIntl(todayYmd)
  if (probed) return probed

  // 最后兜底：按 365.2422 天粗估并在次年 2 月内收敛
  return `${year + 1}-02-05`
}

/**
 * 计算距离下一次春节的天数，当天返回 0。
 */
export function getSpringFestivalCountdown(
  today: string | Date = new Date(),
): { date: string; days: number } {
  const todayYmd = normalizeDay(today) || toYmd(new Date())
  const target = getNextSpringFestival(todayYmd)
  if (!target) return { date: '', days: 0 }
  const a = parseYmd(todayYmd)
  const b = parseYmd(target)
  if (!a || !b) return { date: target, days: 0 }
  const days = Math.round((b.getTime() - a.getTime()) / DAY_MS)
  return { date: target, days: days < 0 ? 0 : days }
}

export const SPRING_FESTIVAL_MIN_YEAR = SPRING_FESTIVAL_TABLE[0].year
export const SPRING_FESTIVAL_MAX_YEAR =
  SPRING_FESTIVAL_TABLE[SPRING_FESTIVAL_TABLE.length - 1].year
