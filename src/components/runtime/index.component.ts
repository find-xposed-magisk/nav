// 开源项目，未经作者同意，不得以抄袭/复制代码/修改源代码版权信息。
// Copyright @ 2018-present xiejiahe. All rights reserved.
// See https://github.com/liuzi6612/nav

import { Component, Input } from '@angular/core'
import { settings } from 'src/store'
import type { IComponentItemProps } from 'src/types'
import { $t } from 'src/locale'
import { component } from 'src/store'

const DAY_MS = 1000 * 60 * 60 * 24

/**
 * 运行时长组件。
 *
 * 显示规则 / Display rule:
 * - 不足 1 年：只显示天数（如「128 天」）
 * - 满 1 年：显示「X 年 Y 天」（如「2 年 2 天」）；Y 为 0 时只显示「X 年」
 *
 * 天数按真实日历天计算（逐毫秒换算后取整），不再用 365 天近似年，
 * 否则每年会累积约 0.24 天的偏差。
 */
@Component({
  standalone: true,
  selector: 'app-runtime',
  templateUrl: './index.component.html',
  styleUrls: ['./index.component.scss'],
})
export class RuntimeComponent {
  @Input() data!: IComponentItemProps

  readonly component = component()

  /** 主数字 / primary value */
  runDays = 0
  /** 主单位 / primary unit */
  unit = ''
  /** 余数天数，满 1 年时才有值 / remaining days, only when a full year exists */
  restDays = 0
  /** 余数单位 / unit of the remainder */
  restUnit = ''
  /** 总天数，用于 tooltip 与副标题 / total days for tooltip */
  totalDays = 0

  constructor() {
    this.init()
  }

  private init() {
    const start = Number(settings().runtime) || 0
    let diff = Date.now() - start
    diff = diff < 0 ? 0 : diff

    const totalDays = Math.floor(diff / DAY_MS)
    this.totalDays = totalDays

    const years = Math.floor(totalDays / 365)
    if (years > 0) {
      // 用真实日历年修正：从起始时间加 N 年后，剩余天数才是真实余数
      const anniversary = new Date(start)
      anniversary.setFullYear(anniversary.getFullYear() + years)
      const restMs = Date.now() - anniversary.getTime()
      const rest = restMs > 0 ? Math.floor(restMs / DAY_MS) : 0
      this.runDays = years
      this.unit = $t('_year')
      this.restDays = rest
      this.restUnit = rest > 0 ? $t('_day') : ''
    } else {
      this.runDays = totalDays
      this.unit = $t('_day')
      this.restDays = 0
      this.restUnit = ''
    }
  }
}
