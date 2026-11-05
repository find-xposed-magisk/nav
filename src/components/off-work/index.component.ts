// 开源项目，未经作者同意，不得以抄袭/复制代码/修改源代码版权信息。
// Copyright @ 2018-present xiejiahe. All rights reserved.
// See https://github.com/liuzi6612/nav

import { Component, Input, OnDestroy } from '@angular/core'
import { CommonModule } from '@angular/common'
import type { IComponentItemProps } from 'src/types'
import { $t } from 'src/locale'
import { component } from 'src/store'

/**
 * 上下班卡片：以 UTC+8 为唯一时区基准，按秒刷新动态时钟与话术。
 * Clock-in/out card: UTC+8 is the only time base; clock and wording refresh per second.
 *
 * 为什么不用浏览器本地时区 / Why not the browser's local zone:
 * 访客可能在任何时区打开站点，卡片要表达的是「北京时间几点、离下班还有多久」，
 * 因此所有计算都在 UTC+8 的坐标系上做，而不是依赖 new Date().getHours()。
 * Visitors may be anywhere; this card answers "what time is it in Beijing" and
 * "how long until I get off", so all arithmetic happens in a fixed UTC+8 frame.
 *
 * 跨午夜班次的处理 / Cross-midnight shifts:
 * 当 end <= start（例如 17:00 → 次日 02:00）时，班次必然跨天；此时若当前时刻早于
 * end，则该班次始于昨天。旧实现直接 setDate(now.getDate()) 会把结束时间压到当天凌晨，
 * 导致一到 17:00 之后就被判成「已休息」——这是原卡片的真实缺陷。
 * When end <= start the shift crosses midnight: if now is before end, the shift began
 * yesterday. The old code forced both ends onto today, so any time after the start was
 * misjudged as rest.
 */

const CN_OFFSET = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const TICK_MS = 1000

type Phase = 'before' | 'working' | 'after'

interface IClock {
  h: number
  m: number
}

/** 把真实时间戳折算成 UTC+8 的日历字段 / project a real timestamp into UTC+8 fields */
function cnParts(ms: number) {
  const d = new Date(ms + CN_OFFSET)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  }
}

/** 从配置时间戳里只取时分（按 UTC+8）/ take HH:mm off a config timestamp in UTC+8 */
function clockOf(ts: number): IClock {
  const d = new Date((Number(ts) || 0) + CN_OFFSET)
  return { h: d.getUTCHours(), m: d.getUTCMinutes() }
}

/** 求 UTC+8 某天某一时刻对应的真实毫秒 / real epoch ms for a UTC+8 wall-clock moment */
function cnTime(
  year: number,
  month: number,
  day: number,
  clock: IClock,
): number {
  return Date.UTC(year, month, day, clock.h, clock.m, 0, 0) - CN_OFFSET
}

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

@Component({
  standalone: true,
  imports: [CommonModule],
  selector: 'app-offwork',
  templateUrl: './index.component.html',
  styleUrls: ['./index.component.scss'],
})
export class OffWorkComponent implements OnDestroy {
  @Input() data!: IComponentItemProps

  readonly component = component()
  $t = $t

  /** UTC+8 当前时钟文本 HH:mm:ss / current UTC+8 wall clock */
  clockText = '--:--:--'
  /** 动态话术 / dynamic wording */
  titleText = ''
  /** 倒计时或已过时长 / countdown or elapsed text */
  countText = ''
  /** 时长的语义前缀，避免"休息啦 + 8小时"这种歧义 / prefix clarifies the span */
  countLabel = ''
  /** 当前所处时段 / current phase */
  phase: Phase = 'before'
  /** 进度 0-100，仅 working 有意义 / progress 0-100, meaningful while working */
  progress = 0

  private timer: any = null
  private destroyed = false
  private readonly onVisibility = () => this.handleVisibility()

  constructor() {
    document.addEventListener('visibilitychange', this.onVisibility)
  }

  get isRest(): boolean {
    return this.phase !== 'working'
  }

  ngOnChanges() {
    this.stop()
    this.tick()
  }

  ngOnDestroy() {
    this.destroyed = true
    this.stop()
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  private handleVisibility() {
    if (document.hidden) {
      this.stop()
    } else {
      this.tick()
    }
  }

  private stop() {
    if (this.timer != null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /**
   * 单次刷新：算时钟、判断时段、生成话术，然后无条件排下一次。
   * 无条件是关键——旧实现在休息态直接 return，跨过下班/上班时刻就再也不会恢复。
   * One tick; always reschedules. The old code returned early in rest state and never
   * recovered when the shift boundary was crossed.
   */
  private tick() {
    if (this.destroyed) return

    const nowMs = Date.now()
    const cn = cnParts(nowMs)
    this.clockText = `${pad(cn.hour)}:${pad(cn.minute)}:${pad(cn.second)}`

    const data = this.data || ({} as IComponentItemProps)
    const startClock = clockOf(data['startDate'] as number)
    const endClock = clockOf(data['date'] as number)

    let startMs = cnTime(cn.year, cn.month, cn.day, startClock)
    let endMs = cnTime(cn.year, cn.month, cn.day, endClock)

    // 结束不晚于开始 = 跨午夜；按当前时刻决定班次算今天还是昨天
    if (endMs <= startMs) {
      if (nowMs < endMs) {
        startMs -= DAY_MS
      } else {
        endMs += DAY_MS
      }
    }

    const isWeekend = cn.weekday === 0 || cn.weekday === 6

    if (nowMs < startMs) {
      this.phase = 'before'
      this.progress = 0
      // 周末不报"距离上班"，否则和「周末，好好休息」相互矛盾
      // On weekends the "until work" span would contradict the rest wording
      this.countText = isWeekend ? '' : this.formatSpan(startMs - nowMs)
      this.countLabel = isWeekend ? '' : this.$t('_offWorkUntilWork')
      this.titleText = this.wordingBefore(cn.weekday, cn.hour)
    } else if (nowMs <= endMs) {
      this.phase = 'working'
      const total = endMs - startMs
      const left = endMs - nowMs
      this.progress = total > 0 ? Math.min(100, Math.max(0, (1 - left / total) * 100)) : 0
      this.countText = this.formatSpan(left)
      this.countLabel = ''
      this.titleText = this.wordingWorking(isWeekend)
    } else {
      this.phase = 'after'
      this.progress = 100
      this.countText = this.formatSpan(nowMs - endMs)
      // 「休息啦 + 8小时」会被读成"已休息8小时"，加前缀表明这是下班后已过时长
      // "Rest + 8h" reads as eight hours of rest; the prefix says it is elapsed time
      this.countLabel = this.$t('_offWorkElapsed')
      this.titleText = this.wordingAfter(cn.weekday, cn.hour)
    }

    this.timer = setTimeout(() => this.tick(), TICK_MS)
  }

  /** 时长格式：小时级显示 h+m，分钟级显示 m+s，秒级显示 s */
  private formatSpan(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    if (h > 0) {
      return `${this.$t('_hours', { num: h })}${this.$t('_minutes', { num: m })}`
    }
    if (m > 0) {
      return `${this.$t('_minutes', { num: m })}${this.$t('_seconds', { num: s })}`
    }
    return this.$t('_seconds', { num: s })
  }

  private wordingWorking(isWeekend: boolean): string {
    // 周末仍在班次内时，用「周末还在忙」而不是默认标题，避免和休息话术混淆
    // On a weekend shift the default title would clash with the rest wording
    if (isWeekend) return this.$t('_offWorkWeekendShift')
    const custom = this.data && this.data['workTitle']
    return custom || this.$t('_offWorkLeft')
  }

  private wordingBefore(weekday: number, hour: number): string {
    if (weekday === 0 || weekday === 6) return this.$t('_offWorkWeekend')
    if (hour < 5) return this.$t('_offWorkDawn')
    const custom = this.data && this.data['restTitle']
    return custom || this.$t('_offWorkToWork')
  }

  private wordingAfter(weekday: number, hour: number): string {
    if (weekday === 0 || weekday === 6) return this.$t('_offWorkWeekend')
    if (hour >= 23 || hour < 5) return this.$t('_offWorkLate')
    const custom = this.data && this.data['restTitle']
    return custom || this.$t('_offWorkDone')
  }
}
