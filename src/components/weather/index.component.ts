// 开源项目，未经作者同意，不得以抄袭/复制代码/修改源代码版权信息。
// Copyright @ 2018-present xiejiahe. All rights reserved.
// See https://github.com/liuzi6612/nav

import { Component, Input, OnDestroy } from '@angular/core'
import { CommonModule } from '@angular/common'
import type { IComponentItemProps } from 'src/types'
import { component } from 'src/store'

/**
 * 天气卡组件（按访客出口 IP 定位）。
 * Weather card keyed on the visitor's egress IP.
 *
 * 边界说明 / Scope note:
 * - 所有视觉资源（图标、渐变、动画）都是内联 SVG 与 CSS，不引用任何外部图片/字体/CSS。
 *   All visuals are inline SVG and CSS; no external image, font, or stylesheet is loaded.
 * - 天气数值无法凭空产生，必须走公开数据接口，因此只保留两个纯 JSON 接口，
 *   并把结果缓存 10 分钟，避免每次进入页面都请求。
 *   Weather values require a public JSON API; responses are cached for 10 minutes.
 */

interface IGeo {
  city: string
  region: string
  country: string
  countryCode: string
  latitude: number
  longitude: number
  ip: string
}

interface IWeatherState {
  loading: boolean
  failed: boolean
  temp: number | null
  feelsLike: number | null
  humidity: number | null
  wind: number | null
  code: number
  isDay: boolean
  place: string
  ip: string
  updatedAt: number
}

const CACHE_KEY = 'nav_weather_cache_v1'
const CACHE_TTL = 10 * 60 * 1000
const FETCH_TIMEOUT = 8000
const DAY_MS = 1000 * 60 * 60 * 24

const GEO_ENDPOINTS = [
  'https://ipwho.is/',
  'https://ipapi.co/json/',
  'https://ipinfo.io/json',
]

function withTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  return fetch(url, { signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  )
}

/** 天气代码 → 语义分类，用于选图标与配色 / WMO code to visual category */
function categoryOf(code: number): string {
  if (code === 0) return 'clear'
  if (code <= 2) return 'partly'
  if (code === 3) return 'cloudy'
  if (code <= 48) return 'fog'
  if (code <= 57) return 'drizzle'
  if (code <= 67) return 'rain'
  if (code <= 77) return 'snow'
  if (code <= 82) return 'shower'
  if (code <= 86) return 'snow'
  return 'thunder'
}

function labelOf(code: number): string {
  const map: Record<number, string> = {
    0: '晴',
    1: '晴间多云',
    2: '多云',
    3: '阴',
    45: '雾',
    48: '雾凇',
    51: '小毛毛雨',
    53: '毛毛雨',
    55: '大毛毛雨',
    56: '冻毛毛雨',
    57: '强冻毛毛雨',
    61: '小雨',
    63: '中雨',
    65: '大雨',
    66: '冻雨',
    67: '强冻雨',
    71: '小雪',
    73: '中雪',
    75: '大雪',
    77: '米雪',
    80: '小阵雨',
    81: '阵雨',
    82: '强阵雨',
    85: '小阵雪',
    86: '强阵雪',
    95: '雷阵雨',
    96: '雷阵雨伴冰雹',
    99: '强雷暴伴冰雹',
  }
  return map[code] || '未知'
}

@Component({
  standalone: true,
  imports: [CommonModule],
  selector: 'app-weather',
  templateUrl: './index.component.html',
  styleUrls: ['./index.component.scss'],
})
export class WeatherComponent implements OnDestroy {
  @Input() data!: IComponentItemProps

  readonly component = component()

  state: IWeatherState = {
    loading: true,
    failed: false,
    temp: null,
    feelsLike: null,
    humidity: null,
    wind: null,
    code: 0,
    isDay: true,
    place: '',
    ip: '',
    updatedAt: 0,
  }

  private destroyed = false
  private timer: any

  get category(): string {
    return categoryOf(this.state.code)
  }

  get label(): string {
    return labelOf(this.state.code)
  }

  get tempText(): string {
    return this.state.temp == null ? '--' : String(Math.round(this.state.temp))
  }

  get placeText(): string {
    if (this.state.place) return this.state.place
    return this.state.loading ? '定位中' : '未知位置'
  }

  constructor() {
    this.init()
    // 每 10 分钟静默刷新一次 / silent refresh every 10 minutes
    this.timer = setInterval(() => this.init(true), CACHE_TTL)
  }

  ngOnDestroy() {
    this.destroyed = true
    clearInterval(this.timer)
  }

  private readCache(): IWeatherState | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as IWeatherState
      if (!parsed || !parsed.updatedAt) return null
      if (Date.now() - parsed.updatedAt > CACHE_TTL * 3) return null
      return parsed
    } catch {
      return null
    }
  }

  private writeCache(s: IWeatherState) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(s))
    } catch {
      // 隐私模式下 localStorage 可能不可写，忽略即可 / ignore in private mode
    }
  }

  private async init(silent = false) {
    if (!silent) {
      const cached = this.readCache()
      if (cached) {
        this.state = { ...cached, loading: false, failed: false }
        // 缓存仍在有效期内就直接用，避免每次进页面都打接口
        // Fresh cache short-circuits the network round trip entirely
        if (Date.now() - cached.updatedAt < CACHE_TTL) return
      }
    }

    try {
      const geo = await this.locate()
      if (this.destroyed) return
      const weather = await this.fetchWeather(geo)
      if (this.destroyed) return

      this.state = {
        loading: false,
        failed: false,
        temp: weather.temp,
        feelsLike: weather.feelsLike,
        humidity: weather.humidity,
        wind: weather.wind,
        code: weather.code,
        isDay: weather.isDay,
        place: geo.city || geo.region || geo.country || geo.ip,
        ip: geo.ip,
        updatedAt: Date.now(),
      }
      this.writeCache(this.state)
    } catch {
      if (this.destroyed) return
      const cached = this.readCache()
      this.state = {
        ...(cached || this.state),
        loading: false,
        failed: !cached,
      }
    }
  }

  /** 逐个尝试定位接口，任一成功即可 / try geolocation providers in order */
  private async locate(): Promise<IGeo> {
    let lastError: any = null
    for (const url of GEO_ENDPOINTS) {
      try {
        const res = await withTimeout(url)
        if (!res.ok) throw new Error(`geo ${res.status}`)
        const j = await res.json()
        const geo = this.parseGeo(j, url)
        if (geo && (geo.latitude || geo.city)) return geo
      } catch (e) {
        lastError = e
      }
    }
    throw lastError || new Error('geo failed')
  }

  private parseGeo(j: any, url: string): IGeo | null {
    if (!j || j.success === false || j.error) return null
    if (url.includes('ipwho.is')) {
      return {
        city: j.city || '',
        region: j.region || '',
        country: j.country || '',
        countryCode: j.country_code || '',
        latitude: Number(j.latitude) || 0,
        longitude: Number(j.longitude) || 0,
        ip: j.ip || '',
      }
    }
    if (url.includes('ipapi.co')) {
      return {
        city: j.city || '',
        region: j.region || '',
        country: j.country_name || '',
        countryCode: j.country_code || '',
        latitude: Number(j.latitude) || 0,
        longitude: Number(j.longitude) || 0,
        ip: j.ip || '',
      }
    }
    if (url.includes('ipinfo.io')) {
      const loc = String(j.loc || '').split(',')
      return {
        city: j.city || '',
        region: j.region || '',
        country: j.country || '',
        countryCode: j.country || '',
        latitude: Number(loc[0]) || 0,
        longitude: Number(loc[1]) || 0,
        ip: j.ip || '',
      }
    }
    return null
  }

  private async fetchWeather(geo: IGeo) {
    const lat = geo.latitude.toFixed(4)
    const lon = geo.longitude.toFixed(4)
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code,is_day' +
      '&timezone=auto'

    const res = await withTimeout(url)
    if (!res.ok) throw new Error(`weather ${res.status}`)
    const j = await res.json()
    const cur = j && j.current ? j.current : {}

    if (cur.temperature_2m == null) throw new Error('weather empty')

    return {
      temp: Number(cur.temperature_2m),
      feelsLike:
        cur.apparent_temperature == null ? null : Number(cur.apparent_temperature),
      humidity:
        cur.relative_humidity_2m == null
          ? null
          : Number(cur.relative_humidity_2m),
      wind: cur.wind_speed_10m == null ? null : Number(cur.wind_speed_10m),
      code: Number(cur.weather_code) || 0,
      isDay: Number(cur.is_day) !== 0,
    }
  }

  /** 供模板判断是否显示夜色遮罩 / used by template for the night overlay */
  get isNight(): boolean {
    return !this.state.isDay
  }

  /** 距缓存刷新的剩余分钟，仅用于 title 提示 / minutes since last update */
  get ageMinutes(): number {
    if (!this.state.updatedAt) return 0
    return Math.max(0, Math.round((Date.now() - this.state.updatedAt) / 60000))
  }

  get tooltipText(): string {
    const parts: string[] = []
    if (this.state.ip) parts.push(this.state.ip)
    if (this.state.feelsLike != null)
      parts.push(`体感 ${Math.round(this.state.feelsLike)}°C`)
    if (this.state.humidity != null) parts.push(`湿度 ${this.state.humidity}%`)
    if (this.state.wind != null) parts.push(`风速 ${this.state.wind} km/h`)
    if (this.state.updatedAt) parts.push(`${this.ageMinutes} 分钟前更新`)
    return parts.join(' · ')
  }
}

export { DAY_MS }
