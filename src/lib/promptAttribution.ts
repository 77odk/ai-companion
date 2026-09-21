export type PromptSource = 'USER' | 'SELF' | 'SHARED'

export type AttributionLang = 'zh' | 'en'

const FULL_MARKER_RE = /\[\s*(?:source\s*=\s*)?(?:USER|SELF|SHARED)\s*\]|【\s*(?:USER|SELF|SHARED)\s*】/gi
const LEADING_MARKER_RE = /^\s*(?:\[\s*(?:source\s*=\s*)?(?:USER|SELF|SHARED)\s*\]|【\s*(?:USER|SELF|SHARED)\s*】)\s*/i
const ATTRIBUTION_TOKEN_RE = /\b(?:USER|SELF|SHARED)(?:'s)?\b|(?:USER|SELF|SHARED)\s*的/gi
const LEGEND_LINE_RE = /^\s*(?:USER|SELF|SHARED)\s*[＝=:].*$/gim

const OPEN_TO_CLOSE: Record<string, string> = {
  '「': '」',
  '『': '』',
  '“': '”',
  '‘': '’',
  '"': '"',
}

/** 只转换引号外的叙述；第三方原话里的「我/你」保持原样。 */
function mapOutsideQuotes(text: string, transform: (chunk: string) => string): string {
  let out = ''
  let plain = ''
  const quoteStack: string[] = []
  const flushPlain = () => {
    if (!plain) return
    out += transform(plain)
    plain = ''
  }

  for (const ch of text) {
    const expected = quoteStack[quoteStack.length - 1]
    if (expected && ch === expected) {
      out += ch
      quoteStack.pop()
      continue
    }
    const close = OPEN_TO_CLOSE[ch]
    if (close) {
      if (quoteStack.length === 0) flushPlain()
      quoteStack.push(close)
      out += ch
      continue
    }
    if (quoteStack.length > 0) out += ch
    else plain += ch
  }
  flushPlain()
  return out
}

function cleanSpacing(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
    .trim()
}

function normalizeChinese(chunk: string, source: PromptSource, perspective: 'USER' | 'SELF' | null): string {
  let text = chunk.replace(FULL_MARKER_RE, '')
  const greetingTarget = perspective === 'SELF' ? 'USER' : 'SELF'
  if (/^你好[呀啊吗嘛！!？?。,.，]*$/.test(text.trim()) && perspective) {
    return `向 ${greetingTarget} 问好`
  }
  const shared = source === 'SELF' ? 'SELF 与 USER' : 'USER 与 SELF'
  text = text.replace(/我们|咱们/g, shared)
  text = text.replace(/对方的|用户的/g, 'USER 的').replace(/对方|用户/g, 'USER')

  if (perspective === 'USER') {
    text = text
      .replace(/我的/g, 'USER 的')
      .replace(/我(?=老公|老婆|男朋友|女朋友|对象|朋友|爸爸|爸|妈妈|妈|家人|同事|老板|老师|孩子|宠物)/g, 'USER 的')
      .replace(/我/g, 'USER')
      .replace(/你的/g, 'SELF 的')
      .replace(/你(?!们)/g, 'SELF')
  } else if (perspective === 'SELF') {
    text = text
      .replace(/我的/g, 'SELF 的')
      .replace(/我(?=老公|老婆|男朋友|女朋友|对象|朋友|爸爸|爸|妈妈|妈|家人|同事|老板|老师|孩子|宠物)/g, 'SELF 的')
      .replace(/我/g, 'SELF')
      .replace(/你的/g, 'USER 的')
      .replace(/你(?!们)/g, 'USER')
  }

  return cleanSpacing(
    text
      .replace(/(USER|SELF)(?=[\u3400-\u9fff])/g, '$1 ')
      .replace(/([\u3400-\u9fff])(USER|SELF)/g, '$1 $2'),
  )
}

function normalizeEnglish(chunk: string, source: PromptSource, perspective: 'USER' | 'SELF' | null): string {
  let text = chunk.replace(FULL_MARKER_RE, '')
  const shared = source === 'SELF' ? 'SELF and USER' : 'USER and SELF'
  text = text
    .replace(/\bwe['’]re\b/gi, `${shared} are`)
    .replace(/\bwe['’]ve\b/gi, `${shared} have`)
    .replace(/\bwe['’]ll\b/gi, `${shared} will`)
    .replace(/\bwe['’]d\b/gi, `${shared} would`)
    .replace(/\b(?:we|us)\b/gi, shared)
    .replace(/\b(?:our|ours)\b/gi, `${shared}'s`)

  if (perspective === 'USER') {
    text = text
      .replace(/\bI['’]m\b/gi, 'USER is')
      .replace(/\bI['’]ve\b/gi, 'USER has')
      .replace(/\bI['’]ll\b/gi, 'USER will')
      .replace(/\bI['’]d\b/gi, 'USER would')
      .replace(/\byou['’]re\b/gi, 'SELF is')
      .replace(/\byou['’]ve\b/gi, 'SELF have')
      .replace(/\byou['’]ll\b/gi, 'SELF will')
      .replace(/\byou['’]d\b/gi, 'SELF would')
      .replace(/\bmy\b/gi, "USER's")
      .replace(/\bmine\b/gi, "USER's")
      .replace(/\b(?:I|me)\b/gi, 'USER')
      .replace(/\byour\b/gi, "SELF's")
      .replace(/\byours\b/gi, "SELF's")
      .replace(/\byou\b/gi, 'SELF')
  } else if (perspective === 'SELF') {
    text = text
      .replace(/\bI['’]m\b/gi, 'SELF is')
      .replace(/\bI['’]ve\b/gi, 'SELF has')
      .replace(/\bI['’]ll\b/gi, 'SELF will')
      .replace(/\bI['’]d\b/gi, 'SELF would')
      .replace(/\byou['’]re\b/gi, 'USER is')
      .replace(/\byou['’]ve\b/gi, 'USER have')
      .replace(/\byou['’]ll\b/gi, 'USER will')
      .replace(/\byou['’]d\b/gi, 'USER would')
      .replace(/\bmy\b/gi, "SELF's")
      .replace(/\bmine\b/gi, "SELF's")
      .replace(/\b(?:I|me)\b/gi, 'SELF')
      .replace(/\byour\b/gi, "USER's")
      .replace(/\byours\b/gi, "USER's")
      .replace(/\byou\b/gi, 'USER')
  }
  return cleanSpacing(text)
}

/** 把一条带来源的旧文本临时归一；不修改存储原文。重复调用结果不变。 */
export function normalizeAttributedText(
  text: string,
  source: PromptSource,
  lang: AttributionLang = 'zh',
  perspective: 'USER' | 'SELF' | null = source === 'SHARED' ? null : source,
): string {
  const raw = String(text ?? '').replace(LEADING_MARKER_RE, '').trim()
  if (!raw) return ''
  return mapOutsideQuotes(raw, (chunk) => {
    const leading = chunk.match(/^\s*/)?.[0] ?? ''
    const trailing = chunk.match(/\s*$/)?.[0] ?? ''
    const core = chunk.slice(leading.length, chunk.length - trailing.length)
    if (!core) return chunk
    const normalized = lang === 'en'
      ? normalizeEnglish(core, source, perspective)
      : normalizeChinese(core, source, perspective)
    return `${leading}${normalized}${trailing}`
  })
}

export function formatAttributedLine(
  text: string,
  source: PromptSource,
  lang: AttributionLang = 'zh',
  perspective: 'USER' | 'SELF' | null = source === 'SHARED' ? null : source,
): string {
  const normalized = normalizeAttributedText(text, source, lang, perspective)
  return normalized ? `[source=${source}] ${normalized}` : ''
}

export function buildAttributionLegend(lang: AttributionLang = 'zh'): string {
  if (lang === 'en') {
    return '[Source Map] USER is the person you are talking with; SELF is you; SHARED belongs to both of you. Source markers are internal context only: never repeat them in the output.'
  }
  return '【来源说明】USER 是与你聊天的人；SELF 是你自己；SHARED 是你们双方。来源标记只用于理解上下文，回复里绝不能输出。'
}

/** 模型偶尔照抄内部标记：在协议解析后、展示或落库前确定性剥离。 */
export function cleanAttributionArtifacts(text: string, lang?: AttributionLang): string {
  const raw = String(text ?? '')
  const resolvedLang = lang ?? (/[\u3400-\u9fff]/.test(raw) ? 'zh' : 'en')
  let out = raw
    .replace(LEGEND_LINE_RE, '')
    .replace(FULL_MARKER_RE, '')

  if (resolvedLang === 'en') {
    out = out
      .replace(/\bSELF's\b/g, 'my')
      .replace(/\bUSER's\b/g, 'your')
      .replace(/\bSHARED's\b/g, 'our')
      .replace(/\bSELF\b/g, 'I')
      .replace(/\bUSER\b/g, 'you')
      .replace(/\bSHARED\b/g, 'we')
  } else {
    out = out
      .replace(/SELF\s*的/g, '我的')
      .replace(/USER\s*的/g, '你的')
      .replace(/SHARED\s*的/g, '你们共同的')
      .replace(/\bSELF\b/g, '我')
      .replace(/\bUSER\b/g, '你')
      .replace(/\bSHARED\b/g, '我们')
      .replace(/([我你])\s+(?=[\u3400-\u9fff])/g, '$1')
      .replace(/([\u3400-\u9fff])\s+([我你])/g, '$1$2')
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function hasAttributionLeak(text: string): boolean {
  const value = String(text ?? '')
  const marker = new RegExp(FULL_MARKER_RE.source, FULL_MARKER_RE.flags)
  const token = new RegExp(ATTRIBUTION_TOKEN_RE.source, ATTRIBUTION_TOKEN_RE.flags)
  const legend = new RegExp(LEGEND_LINE_RE.source, LEGEND_LINE_RE.flags)
  const brokenMarker = /(?:\[|【)\s*(?:source\s*=\s*)?(?:U(?:S(?:E(?:R)?)?)?|S(?:E(?:L(?:F)?)?|H(?:A(?:R(?:E(?:D)?)?)?)?))\s*(?:\]|】)?\s*$/i
  const sourceAssignment = /(?:\[|【)?\s*source\s*=/i
  const legendHeader = /(?:【\s*来源说明\s*】|\[\s*Source Map\s*\])/i
  return marker.test(value) || token.test(value) || legend.test(value) || brokenMarker.test(value) || sourceAssignment.test(value) || legendHeader.test(value)
}

const PARTIAL_MARKERS = [
  '[USER]', '[SELF]', '[SHARED]', '[source=USER]', '[source=SELF]', '[source=SHARED]',
  '【USER】', '【SELF】', '【SHARED】', 'USER', 'SELF', 'SHARED',
]

/** 流式展示专用：完整净化之外，暂存末尾尚未收齐的内部标记前缀，防止闪现。 */
export function cleanStreamingAttributionArtifacts(text: string, lang: AttributionLang = 'zh'): string {
  const raw = String(text ?? '')
  const findPartialStart = (value: string): number => {
    for (let index = 0; index < value.length; index += 1) {
      const tail = value.slice(index)
      if (!tail || !PARTIAL_MARKERS.some((marker) => marker.toLowerCase().startsWith(tail.toLowerCase()))) continue
      const previous = index > 0 ? value[index - 1] : ''
      const bracketed = tail.startsWith('[') || tail.startsWith('【')
      if (bracketed || index === 0 || /\s/.test(previous)) return index
    }
    return -1
  }

  const rawPartialStart = findPartialStart(raw)
  if (rawPartialStart >= 0) return cleanAttributionArtifacts(raw.slice(0, rawPartialStart), lang)
  const cleaned = cleanAttributionArtifacts(raw, lang)
  const cleanedPartialStart = findPartialStart(cleaned)
  if (cleanedPartialStart >= 0) return cleaned.slice(0, cleanedPartialStart).trimEnd()
  return cleaned
}
