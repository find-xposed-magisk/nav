// 开源项目，未经作者同意，不得以抄袭/复制代码/修改源代码版权信息。
// Copyright @ 2018-present xiejiahe. All rights reserved.
// See https://github.com/liuzi6612/nav

import { Component, Input } from '@angular/core'
import type { IComponentItemProps } from 'src/types'
import dayjs from 'dayjs'
import { component } from 'src/store'
import { getSpringFestivalCountdown } from 'src/utils/lunar'

interface IProps {
  dateStr: string
  dayStr: number
  /** 目标日是否为自动推算所得 / whether the target date is auto-resolved */
  auto: boolean
  /** 目标日所在年份，用于副标题 / target year for the caption */
  year: number
}

/**
 * 倒计时组件。
 *
 * 支持两种日期来源 / Two date sources:
 * 1. `data.autoSpringFestival`（或 `data.title` 含「春节」且 `data.date` 为空/已过期）时，
 *    走 `getSpringFestivalCountdown()` 动态推算下一次春节，不会过期。
 * 2. 否则沿用原有行为，取 `data.date` 写死值。
 *
 * 之所以保留写死值这条路径，是因为后台允许自定义任意倒计时目标（生日、纪念日等），
 * 只有春节这一项是「年年都有的固定节日」，才需要自动滚到下一次。
 */
@Component({
  standalone: true,
  selector: 'app-countdown',
  templateUrl: './index.component.html',
  styleUrls: ['./index.component.scss'],
})
export class CountdownComponent {
  @Input() data!: IComponentItemProps

  readonly component = component()
  countdownData = {} as IProps

  constructor() {}

  ngOnInit() {
    this.init()
  }

  ngOnChanges() {
    this.init()
  }

  private isSpringFestivalTarget(): boolean {
    const title = String(this.data['title'] || '')
    if (this.data['autoSpringFestival']) return true
    return title.includes('春节')
  }

  private init() {
    const payload = {} as IProps

    if (this.isSpringFestivalTarget()) {
      const { date, days } = getSpringFestivalCountdown(new Date())
      payload.dateStr = dayjs(date).format('YYYY.MM.DD')
      payload.dayStr = days
      payload.auto = true
      payload.year = Number(date.slice(0, 4)) || dayjs().year()
      this.countdownData = payload
      return
    }

    if (this.data['date']) {
      payload.dateStr = dayjs(this.data['date']).format('YYYY.MM.DD')
      payload.dayStr = dayjs(
        dayjs(this.data['date']).format('YYYY-MM-DD'),
      ).diff(dayjs().format('YYYY-MM-DD'), 'day')
      payload.dayStr = payload.dayStr < 0 ? 0 : payload.dayStr
      payload.dayStr = payload.dayStr > 9999 ? 9999 : payload.dayStr
      payload.auto = false
      payload.year = dayjs(this.data['date']).year()
    }
    this.countdownData = payload
  }
}
