// 开源项目，未经作者同意，不得以抄袭/复制代码/修改源代码版权信息。
// Copyright @ 2018-present xiejiahe. All rights reserved.
// See https://github.com/liuzi6612/nav

import { Component, Input, OnDestroy } from '@angular/core'
import { CommonModule } from '@angular/common'
import type { IComponentItemProps } from 'src/types'
import { component } from 'src/store'

/**
 * 天气卡组件：同时辨别「国内出口」与「海外出口」，以国内出口为准。
 * Weather card that separates the domestic and overseas egress and defers to the
 * domestic one.
 *
 * 为什么要多源投票 / Why multi-source voting:
 * 浏览器只能拿到一个出口 IP，但它可能落在国内，也可能是代理/VPN 的海外节点。
 * 单一接口（如 ipwho.is、ipinfo.io）总是先返回海外节点，于是"以国内为准"就落空了。
 * 这里并发问一组国内源与海外源：只要有任一源判定归属在中国，就认为出口在国内，
 * 用这个源的城市作为主城市；全部源都判定在境外，说明访问者走了海外线路，
 * 此时主城市回退到最近一次记录的国内城市（没有则用默认基准城市），
 * 同时把海外出口城市作为副行展示——两张城市天气并列，一眼能分辨走的是哪条线。
 * Browsers expose exactly one egress IP, which may be a domestic line or an overseas
 * proxy hop. Single-provider lookups always report the overseas hop, defeating the
 * "domestic first" rule. We therefore fan out to both domestic and overseas providers:
 * if any source says China, the egress is domestic and that city becomes primary.
 * Otherwise the visitor is on an overseas line, so the primary falls back to the last
 * known domestic city (or a default baseline) and the overseas egress is shown beside it.
 *
 * 边界说明 / Scope note:
 * - 图标、渐变与动画全部是内联 SVG 与 CSS，不引用任何外部图片、字体或样式表。
 *   All icons, gradients and animations are inline SVG/CSS; no external image, font or
 *   stylesheet is loaded.
 * - 数值无法凭空产生，必须走公开 JSON 接口；结果缓存 10 分钟。
 *   Numeric values require public JSON APIs; responses are cached for 10 minutes.
 */

interface IGeo {
  ip: string
  city: string
  region: string
  country: string
  countryCode: string
  latitude: number
  longitude: number
  /** 数据源是否属于国内服务 / whether the source itself is a domestic service */
  source: string
}

interface IPlaceWeather {
  city: string
  label: string
  temp: number | null
  code: number
  isDay: boolean
  feelsLike: number | null
  humidity: number | null
  wind: number | null
}

interface IWeatherState {
  loading: boolean
  failed: boolean
  /** 主城市（以国内出口为准）/ primary city, domestic egress preferred */
  primary: IPlaceWeather | null
  /** 副城市（另一条出口线路）/ secondary city for the other egress line */
  secondary: IPlaceWeather | null
  /** 当前出口归属，用于判断主城市是"实测"还是"回退基准" */
  egressInChina: boolean
  /** 主城市是否来自实测 IP（false = 用了基准城市）/ primary came from a real IP */
  primaryMeasured: boolean
  ip: string
  updatedAt: number
}

const CACHE_KEY = 'nav_weather_cache_v2'
const HOME_KEY = 'nav_weather_home_city'
const CACHE_TTL = 10 * 60 * 1000
const FETCH_TIMEOUT = 7000

/** 国内基准城市，仅在没有历史记录时兜底 / baseline when no domestic city was seen */
const BASELINE_CITY = { city: '上海', latitude: 31.2222, longitude: 121.4581 }

/** 归属判定为中国的数据源优先，用于把出口锁到国内 / sources prioritised for CN egress */
const GEO_SOURCES: Array<{
  url: string
  domestic: boolean
  parse: (j: any) => IGeo | null
}> = [
  {
    // 国内：ipip.net，返回 ["中国","上海","上海","","电信"] 数组
    url: 'https://myip.ipip.net/json',
    domestic: true,
    parse: (j) => {
      if (!j || j.ret !== 'ok') return null
      const d = j.data || {}
      const loc: string[] = Array.isArray(d.location) ? d.location : []
      const country = loc[0] || ''
      return {
        ip: d.ip || '',
        city: loc[2] || loc[1] || '',
        region: loc[1] || '',
        country,
        countryCode: country.includes('中国') ? 'CN' : '',
        latitude: 0,
        longitude: 0,
        source: 'ipip',
      }
    },
  },
  {
    // 国内：zxinc.org，location 形如 "中国–上海–上海 腾讯云"
    url: 'https://ip.zxinc.org/api.php?type=json',
    domestic: true,
    parse: (j) => {
      if (!j || j.code !== 0 || !j.data) return null
      const d = j.data
      const country = d.country || ''
      const parts = String(country).split('–')
      return {
        ip: d.myip || '',
        city: parts[2] || parts[1] || '',
        region: parts[1] || '',
        country,
        countryCode: country.includes('中国') ? 'CN' : '',
        latitude: 0,
        longitude: 0,
        source: 'zxinc',
      }
    },
  },
  {
    // 海外：ipwho.is（自带经纬度，最省一次地理编码）
    url: 'https://ipwho.is/',
    domestic: false,
    parse: (j) => {
      if (!j || j.success === false) return null
      return {
        ip: j.ip || '',
        city: j.city || '',
        region: j.region || '',
        country: j.country || '',
        countryCode: j.country_code || '',
        latitude: Number(j.latitude) || 0,
        longitude: Number(j.longitude) || 0,
        source: 'ipwho',
      }
    },
  },
  {
    // 海外：ipinfo.io
    url: 'https://ipinfo.io/json',
    domestic: false,
    parse: (j) => {
      if (!j || !j.ip) return null
      const loc = String(j.loc || '').split(',')
      return {
        ip: j.ip || '',
        city: j.city || '',
        region: j.region || '',
        country: j.country || '',
        countryCode: j.country || '',
        latitude: Number(loc[0]) || 0,
        longitude: Number(loc[1]) || 0,
        source: 'ipinfo',
      }
    },
  },
]

/** WMO 天气代码 → 视觉分类 / WMO code to a visual category */
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

/** 天气代码 → 中文名 / WMO code to a Chinese label */
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

function withTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  return fetch(url, { signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  )
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
    primary: null,
    secondary: null,
    egressInChina: true,
    primaryMeasured: true,
    ip: '',
    updatedAt: 0,
  }

  private destroyed = false
  private timer: any

  get category(): string {
    return categoryOf(this.state.primary?.code ?? 0)
  }

  get label(): string {
    return this.state.primary ? labelOf(this.state.primary.code) : '--'
  }

  get tempText(): string {
    const t = this.state.primary?.temp
    return t == null ? '--' : String(Math.round(t))
  }

  get placeText(): string {
    if (this.state.primary?.city) return this.state.primary.city
    return this.state.loading ? '定位中' : '未知位置'
  }

  /** 主城市来源说明：实测出口 / 国内基准 / 海外线路 / caption for the primary city */
  get placeNote(): string {
    if (this.state.loading) return '正在辨别出口线路'
    if (this.state.primaryMeasured) {
      return this.state.egressInChina ? '国内出口' : '海外出口'
    }
    return '国内基准'
  }

  /** 副城市一行文案（另一条线路）/ one-liner for the other egress line */
  get secondaryText(): string {
    const s = this.state.secondary
    if (!s) return ''
    const t = s.temp == null ? '--' : String(Math.round(s.temp))
    return `${s.label} ${s.city} ${t}°`
  }

  get secondaryTag(): string {
    return this.state.egressInChina ? '海外线路' : '国内线路'
  }

  get isNight(): boolean {
    return this.state.primary ? !this.state.primary.isDay : false
  }

  get ageMinutes(): number {
    if (!this.state.updatedAt) return 0
    return Math.max(0, Math.round((Date.now() - this.state.updatedAt) / 60000))
  }

  get tooltipText(): string {
    const p = this.state.primary
    const parts: string[] = []
    if (this.state.ip) parts.push(this.state.ip)
    parts.push(this.state.egressInChina ? '出口：国内' : '出口：海外')
    if (p?.feelsLike != null) parts.push(`体感 ${Math.round(p.feelsLike)}°C`)
    if (p?.humidity != null) parts.push(`湿度 ${p.humidity}%`)
    if (p?.wind != null) parts.push(`风速 ${p.wind} km/h`)
    if (this.state.updatedAt) parts.push(`${this.ageMinutes} 分钟前更新`)
    return parts.join(' · ')
  }

  constructor() {
    this.init()
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
      // 隐私模式下 localStorage 不可写，忽略 / ignore when storage is unavailable
    }
  }

  private readHome(): string {
    try {
      return localStorage.getItem(HOME_KEY) || ''
    } catch {
      return ''
    }
  }

  private writeHome(city: string) {
    if (!city) return
    try {
      localStorage.setItem(HOME_KEY, city)
    } catch {
      // 同上层，忽略 / same as above
    }
  }

  private async init(silent = false) {
    if (!silent) {
      const cached = this.readCache()
      if (cached) {
        this.state = { ...cached, loading: false, failed: false }
        // 缓存新鲜就直接用，避免每次进页面都打接口
        // Fresh cache short-circuits the network round trip
        if (Date.now() - cached.updatedAt < CACHE_TTL) return
      }
    }

    try {
      const geos = await this.collectGeos()
      if (this.destroyed) return
      if (!geos.length) throw new Error('geo empty')

      const cn = geos.find((g) => this.isChina(g))
      const foreign = geos.find((g) => !this.isChina(g))
      const egressInChina = !!cn

      // 主城市：国内出口优先；没有国内源命中就回退最近一次国内城市
      const primaryGeo = cn || null
      const secondaryGeo = cn ? foreign || null : foreign || null

      const homeCity = this.readHome()
      const primaryTarget = primaryGeo
        ? await this.resolveCoords(primaryGeo)
        : await this.resolveCity(homeCity || BASELINE_CITY.city)

      const primary = primaryTarget
        ? await this.buildPlace(
            primaryGeo?.city || primaryTarget.city || homeCity || BASELINE_CITY.city,
            primaryTarget,
          )
        : null

      if (!primary) throw new Error('primary failed')

      if (cn && cn.city) this.writeHome(cn.city)

      let secondary: IPlaceWeather | null = null
      if (secondaryGeo) {
        const coords = await this.resolveCoords(secondaryGeo)
        if (coords) {
          secondary = await this.buildPlace(secondaryGeo.city || '未知', coords)
        }
      } else if (cn) {
        // 出口在国内时，副行留空（没有另一条线路可展示）
        secondary = null
      }

      if (this.destroyed) return

      this.state = {
        loading: false,
        failed: false,
        primary,
        secondary,
        egressInChina,
        primaryMeasured: !!primaryGeo,
        ip: (primaryGeo || geos[0])?.ip || '',
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

  private isChina(g: IGeo): boolean {
    if (g.countryCode === 'CN') return true
    return /中国|China/i.test(g.country || '')
  }

  /** 并发问所有源，任一成功即可 / fan out to every source, keep whatever answers */
  private async collectGeos(): Promise<IGeo[]> {
    const tasks = GEO_SOURCES.map(async (src) => {
      try {
        const res = await withTimeout(src.url)
        if (!res.ok) throw new Error(`${src.url} ${res.status}`)
        const j = await res.json()
        const geo = src.parse(j)
        return geo
      } catch {
        return null
      }
    })
    const settled = await Promise.all(tasks)
    return settled.filter((g): g is IGeo => !!g && !!g.ip)
  }

  private async resolveCoords(geo: IGeo): Promise<{
    city: string
    latitude: number
    longitude: number
  } | null> {
    if (geo.latitude && geo.longitude) {
      return { city: geo.city, latitude: geo.latitude, longitude: geo.longitude }
    }
    return this.resolveCity(geo.city)
  }

  /** 城市名 → 经纬度，用 open-meteo 的地理编码 / city name to coords via geocoding */
  private async resolveCity(city: string): Promise<{
    city: string
    latitude: number
    longitude: number
  } | null> {
    if (!city) return null
    const url =
      'https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&format=json&name=' +
      encodeURIComponent(city)
    try {
      const res = await withTimeout(url)
      if (!res.ok) throw new Error(`geocode ${res.status}`)
      const j = await res.json()
      const hit = Array.isArray(j?.results) ? j.results[0] : null
      if (!hit) return null
      return {
        city: hit.name || city,
        latitude: Number(hit.latitude),
        longitude: Number(hit.longitude),
      }
    } catch {
      return null
    }
  }

  private async buildPlace(
    city: string,
    coords: { latitude: number; longitude: number },
  ): Promise<IPlaceWeather> {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude.toFixed(4)}` +
      `&longitude=${coords.longitude.toFixed(4)}` +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code,is_day' +
      '&timezone=auto'
    const res = await withTimeout(url)
    if (!res.ok) throw new Error(`weather ${res.status}`)
    const j = await res.json()
    const cur = j?.current || {}
    const code = Number(cur.weather_code) || 0
    return {
      city,
      label: labelOf(code),
      temp: cur.temperature_2m == null ? null : Number(cur.temperature_2m),
      code,
      isDay: Number(cur.is_day) !== 0,
      feelsLike:
        cur.apparent_temperature == null
          ? null
          : Number(cur.apparent_temperature),
      humidity:
        cur.relative_humidity_2m == null
          ? null
          : Number(cur.relative_humidity_2m),
      wind: cur.wind_speed_10m == null ? null : Number(cur.wind_speed_10m),
    }
  }
}
