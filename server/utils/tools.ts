import faqData from '../data/faq.json'

export interface ToolCall {
  id: string
  type?: string
  function: {
    name: string
    arguments: string
  }
}

export const CHAT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_weather',
      description:
        '查询指定城市的实时天气（气温、湿度、风速、天气概况）。用户问天气、气温、是否下雨、穿什么时使用。',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '城市名称，例如：北京、上海、广州、杭州',
          },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_faq',
      description:
        '在本地客服 FAQ 知识库中搜索：发货物流、退货退款、发票、忘记密码、会员积分、人工客服等。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '用户问题的检索关键词或原问题',
          },
        },
        required: ['query'],
      },
    },
  },
]

const WEATHER_CODE_MAP: Record<number, string> = {
  0: '晴',
  1: '大致晴',
  2: '局部多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '大毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  80: '阵雨',
  81: '强阵雨',
  82: '暴阵雨',
  95: '雷阵雨',
}

interface FaqItem {
  id: string
  tags: string[]
  question: string
  answer: string
}

function scoreFaq(item: FaqItem, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0

  let score = 0
  const hay = `${item.question} ${item.answer} ${item.tags.join(' ')}`.toLowerCase()

  for (const tag of item.tags) {
    if (q.includes(tag.toLowerCase()) || hay.includes(q)) {
      score += 3
    }
    if (q.includes(tag.toLowerCase())) score += 5
  }

  // 按字/词粗匹配：中文按单字、英文按空格
  const tokens = q.split(/[\s,，。？?！!、]+/).filter((t) => t.length >= 1)
  for (const token of tokens) {
    if (token.length >= 2 && hay.includes(token)) score += 2
    else if (token.length === 1 && item.tags.some((t) => t.includes(token))) score += 1
  }

  if (item.question.includes(query.trim())) score += 8
  return score
}

export function searchFaq(query: string): string {
  const items = faqData as FaqItem[]
  const ranked = items
    .map((item) => ({ item, score: scoreFaq(item, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  if (ranked.length === 0) {
    return JSON.stringify({
      found: false,
      message: '知识库中未找到相关 FAQ，请换个问法或建议转人工。',
      tips: items.map((i) => i.question),
    })
  }

  return JSON.stringify({
    found: true,
    results: ranked.map(({ item, score }) => ({
      question: item.question,
      answer: item.answer,
      score,
    })),
  })
}

export async function getWeather(city: string): Promise<string> {
  const name = city.trim()
  if (!name) {
    return JSON.stringify({ ok: false, error: '城市名不能为空' })
  }

  try {
    const geoUrl =
      `https://geocoding-api.open-meteo.com/v1/search`
      + `?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`

    const geoRes = await fetch(geoUrl)
    if (!geoRes.ok) {
      return JSON.stringify({ ok: false, error: '地理编码服务暂时不可用' })
    }

    const geo = await geoRes.json() as {
      results?: Array<{ name: string; country?: string; latitude: number; longitude: number; admin1?: string }>
    }

    const place = geo.results?.[0]
    if (!place) {
      return JSON.stringify({ ok: false, error: `找不到城市「${name}」` })
    }

    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast`
      + `?latitude=${place.latitude}&longitude=${place.longitude}`
      + `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`
      + `&timezone=auto`

    const weatherRes = await fetch(weatherUrl)
    if (!weatherRes.ok) {
      return JSON.stringify({ ok: false, error: '天气服务暂时不可用' })
    }

    const weather = await weatherRes.json() as {
      current?: {
        temperature_2m?: number
        relative_humidity_2m?: number
        weather_code?: number
        wind_speed_10m?: number
        time?: string
      }
    }

    const current = weather.current
    if (!current) {
      return JSON.stringify({ ok: false, error: '未获取到天气数据' })
    }

    const code = current.weather_code ?? -1
    return JSON.stringify({
      ok: true,
      city: place.name,
      region: place.admin1 || '',
      country: place.country || '',
      observedAt: current.time,
      temperatureC: current.temperature_2m,
      humidityPercent: current.relative_humidity_2m,
      windSpeedKmh: current.wind_speed_10m,
      condition: WEATHER_CODE_MAP[code] || `天气代码 ${code}`,
    })
  } catch {
    return JSON.stringify({ ok: false, error: '天气查询失败，请稍后再试' })
  }
}

export async function runTool(name: string, argsJson: string): Promise<string> {
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>
  } catch {
    return JSON.stringify({ ok: false, error: '工具参数不是合法 JSON' })
  }

  if (name === 'get_weather') {
    return getWeather(String(args.city || ''))
  }
  if (name === 'search_faq') {
    return searchFaq(String(args.query || ''))
  }
  return JSON.stringify({ ok: false, error: `未知工具: ${name}` })
}
