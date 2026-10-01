// 自定义人设 · 结构化表单拼接（纯函数，可 Node 单测）
// 表单只是 UI 层拆分：前端把四个字段拼成一段完整 persona 文本，依旧只存 ai_companion_persona 单字段。
// 不新增存储字段、不碰后端。性格必填的校验交给 UI 层，拼接函数本身不抛错。

export const PERSONA_SOFT_LIMIT = 1500
export const PERSONA_HARD_LIMIT = 4000

/**
 * 人设统一字数口径：去掉空白与换行后计字符数。
 * B 的“明显较长”与 C 的软/硬上限必须复用这个函数，避免同一张卡口径漂移。
 */
export function countPersonaCharacters(text: string): number {
  // PERSONA_CONTENT_ESCAPE 是内部序列化标记，不属于用户内容，不能占用可见字数额度。
  return (text ?? '').replace(/\u200B/g, '').replace(/\s/g, '').length
}

/**
 * 保存长度规则：
 * - 新卡 / 正常卡：<= 4000 才能保存；
 * - 存量已超长卡：绝不截断，允许不比当前已保存内容更长（5200→5100 可，5200→5300 不可）。
 */
export function canSavePersonaLength(nextPersona: string, savedPersona = ''): boolean {
  const nextLength = countPersonaCharacters(nextPersona)
  const savedLength = countPersonaCharacters(savedPersona)
  if (nextLength <= PERSONA_HARD_LIMIT) return true
  return savedLength > PERSONA_HARD_LIMIT && nextLength <= savedLength
}

function normalizePersonaName(value: string): string {
  return value
    .trim()
    .replace(/[。；;，,]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase()
}

/**
 * 字段式姓名行：允许前面带一个短标签。
 * 表单拼接会给人设首行加「性格特质：」「关系背景：」这类前缀，用户写的「姓名：A」拼完就成
 * 「关系背景：姓名：A」——严格行首匹配会漏掉它（实测：两个不同姓名字段一个都不命中）。
 * 仍然只认带冒号的字段写法，叙述里的「名字叫……」不算。
 */
const NAME_FIELD_RE = /(?:^|[：:\s])(?:姓名|名字)\s*[：:]\s*([^\r\n]+?)\s*$/gm

function explicitNameFields(persona: string): string[] {
  if (!persona) return []
  const names: string[] = []
  for (const match of persona.matchAll(NAME_FIELD_RE)) {
    const normalized = normalizePersonaName(match[1] ?? '')
    if (normalized) names.push(normalized)
  }
  return names
}

/**
 * 身份冲突轻提示，只认强信号：
 * 1) 行首/字段式「姓名：」「名字：」出现两个及以上不同值；
 * 2) 「【她心中的我】」「【我】」分节内出现明确姓名，且与主角色名不同。
 *
 * 叙述中的“名字叫……”不算；主角色名为空时只走第 1 条。
 */
export function hasPersonaIdentityConflict(persona: string, primaryName?: string): boolean {
  const distinctNames = new Set(explicitNameFields(persona))
  if (distinctNames.size >= 2) return true

  const primary = normalizePersonaName(primaryName ?? '')
  if (!primary || !persona) return false

  let inTargetSection = false
  for (const rawLine of persona.split(/\r?\n/)) {
    const heading = rawLine.match(/^\s*【([^】]+)】\s*$/)
    if (heading) {
      const title = (heading[1] ?? '').trim()
      inTargetSection = title === '她心中的我' || title === '我'
      continue
    }
    if (!inTargetSection) continue

    const nameMatch = rawLine.match(/^\s*(?:姓名|名字)\s*[：:]\s*(.+?)\s*$/)
    if (!nameMatch) continue
    const sectionName = normalizePersonaName(nameMatch[1] ?? '')
    if (sectionName && sectionName !== primary) return true
  }

  return false
}

export interface CustomPersonaInput {
  /** TA昵称（选填） */
  nickname?: string
  /** 性格特质（必填，UI 层校验） */
  personality: string
  /** 关系&背景设定（选填） */
  background?: string
  /** 开场第一句（选填） */
  opening?: string
}

/**
 * 把结构化表单拼成完整 persona 文本。
 * 输入框为空的条目删掉对应整行，不写入；所有行按固定顺序用换行连接。
 */
export function buildCustomPersona(input: CustomPersonaInput): string {
  const nickname = input.nickname?.trim() ?? ''
  const personality = input.personality?.trim() ?? ''
  const background = input.background?.trim() ?? ''
  const opening = input.opening?.trim() ?? ''

  const lines: string[] = []
  if (nickname) lines.push(serializePersonaField('nickname', nickname))
  if (personality) lines.push(serializePersonaField('personality', personality))
  if (background) lines.push(serializePersonaField('background', background))
  if (opening) lines.push(serializePersonaField('opening', opening))
  return lines.join('\n')
}

/**
 * 从 persona 文本里解析「初次见面开场白：xxx」这一行的内容（开场白机制用）。
 * 没有这一行或内容为空 → 返回空串。
 */
export function extractOpeningLine(persona: string): string {
  return personaValue(persona, 'opening')
}

/**
 * 自定义表单是否有效：性格特质 trim 后非空。
 * 这里只做基础必填校验；长度由共用计数函数在 UI 保存前统一判断。
 */
export function isCustomPersonaValid(input: { personality?: string }): boolean {
  return (input.personality ?? '').trim() !== ''
}

// ---- 人设字段解析 / 编辑（TASK-UI1：设定弹窗 + TA 资料卡共用） ----

const LINE_LABELS = {
  nickname: '角色昵称',
  personality: '性格特质',
  background: '关系背景',
  opening: '初次见面开场白',
} as const

type PersonaField = keyof typeof LINE_LABELS

const PERSONA_FIELDS = Object.keys(LINE_LABELS) as PersonaField[]
const MULTILINE_FIELDS = new Set<PersonaField>(['personality', 'background'])

// 多行 textarea 内容与字段标签共用一条 persona 字符串。
 // 用零宽字符只转义“看起来像字段标签”的正文行：界面读回时会还原，避免正文被误判成字段边界。
const PERSONA_CONTENT_ESCAPE = '\u200B'

function isPersonaFieldLine(line: string): boolean {
  return PERSONA_FIELDS.some((field) => new RegExp(`^\\s*${LINE_LABELS[field]}：`).test(line))
}

function escapePersonaContent(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line, index) => {
      // 用户原文自己以零宽字符开头时也要先转义，否则读回时会误删这个真实字符。
      if (line.startsWith(PERSONA_CONTENT_ESCAPE)) return PERSONA_CONTENT_ESCAPE + line
      if (index > 0 && isPersonaFieldLine(line)) return PERSONA_CONTENT_ESCAPE + line
      return line
    })
    .join('\n')
}

function unescapePersonaContent(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.startsWith(PERSONA_CONTENT_ESCAPE) ? line.slice(PERSONA_CONTENT_ESCAPE.length) : line)
    .join('\n')
}

/** 把内部序列化标记还原成用户原文；供 Chat / prompt 等语义消费入口使用。 */
export function decodePersonaText(persona: string): string {
  return unescapePersonaContent(persona ?? '')
}

function serializePersonaField(field: PersonaField, value: string): string {
  const encoded = MULTILINE_FIELDS.has(field) ? escapePersonaContent(value) : value
  return `${LINE_LABELS[field]}：${encoded}`
}

function personaFieldAtLine(line: string): PersonaField | null {
  for (const field of PERSONA_FIELDS) {
    if (new RegExp(`^\\s*${LINE_LABELS[field]}：`).test(line)) return field
  }
  return null
}

/**
 * 读取结构化 persona 字段。
 * - 昵称 / 开场白来自单行 input，只读标签所在行；
 * - 性格 / 关系背景来自 textarea，保留后续换行，直到下一个已知字段标签。
 */
function personaValue(persona: string, field: PersonaField): string {
  if (!persona) return ''
  const lines = persona.split(/\r?\n/)
  const prefix = new RegExp(`^\\s*${LINE_LABELS[field]}：`)

  for (let i = 0; i < lines.length; i++) {
    if (personaFieldAtLine(lines[i]) !== field) continue

    const first = lines[i].replace(prefix, '')
    if (!MULTILINE_FIELDS.has(field)) return first.trim()

    const value = [first]
    for (let j = i + 1; j < lines.length; j++) {
      if (personaFieldAtLine(lines[j])) break
      value.push(lines[j])
    }
    return unescapePersonaContent(value.join('\n').trim())
  }
  return ''
}

/**
 * 去掉指定字段。
 * 性格 / 关系背景是 textarea 字段，删除时连同续行一起去掉；
 * 昵称 / 开场白只删除标签所在单行，不能误吞旧版自由文本正文。
 */
function dropPersonaFields(persona: string, fields: PersonaField[]): string {
  if (!persona) return ''
  const removed = new Set(fields)
  const kept: string[] = []
  let skipContinuation = false

  for (const line of persona.split(/\r?\n/)) {
    const field = personaFieldAtLine(line)
    if (field) {
      const shouldRemove = removed.has(field)
      skipContinuation = shouldRemove && MULTILINE_FIELDS.has(field)
      if (!shouldRemove) kept.push(line)
      continue
    }
    if (!skipContinuation) kept.push(line)
  }

  return kept.join('\n')
}

/**
 * 从 persona 解析「性格特质」内容（资料卡显示用）：
 * - 结构化人设（自定义，含「性格特质：」行）→ 取该行内容；
 * - 模板原文（无结构化性格行）→ 返回去掉附加的背景/开场白/昵称行后的主体。
 */
export function extractPersonality(persona: string): string {
  const structured = personaValue(persona, 'personality')
  if (structured) return structured
  return dropPersonaFields(persona, ['background', 'opening', 'nickname']).trim()
}

/** 从 persona 解析「关系背景」行内容（无 → 空串） */
export function extractBackgroundLine(persona: string): string {
  return personaValue(persona, 'background')
}

export interface PersonaEdits {
  /** 性格特质正文；不传 = 保持原值，空串 = 删掉该行（模板原文即删掉主体） */
  personality?: string
  /** 关系背景正文；不传 = 保持原值，空串 = 删掉该行 */
  background?: string
  /** 开场第一句正文；不传 = 保持原值，空串 = 删掉该行 */
  opening?: string
}

/**
 * 应用人设编辑，返回新 persona 文本（TASK-UI1 资料卡逐项修改用）。
 * - 结构化人设（自定义：含「性格特质：」行）→ 保留角色昵称行，替换/追加其余行；
 * - 自由文本人设（模板原文：无结构化性格行）→ 主体 = 原文本去掉附加的背景/开场白行，改性格即替换主体。
 * 传 undefined 的字段保持原值，传空字符串 = 删除该行。
 */
export function applyPersonaEdits(persona: string, edits: PersonaEdits): string {
  const structured = /^\s*性格特质：/m.test(persona)
  const background = edits.background !== undefined ? edits.background.trim() : personaValue(persona, 'background')
  const opening = edits.opening !== undefined ? edits.opening.trim() : personaValue(persona, 'opening')

  if (structured) {
    const nickname = personaValue(persona, 'nickname')
    const personality =
      edits.personality !== undefined ? edits.personality.trim() : personaValue(persona, 'personality')
    const lines: string[] = []
    if (nickname) lines.push(serializePersonaField('nickname', nickname))
    if (personality) lines.push(serializePersonaField('personality', personality))
    if (background) lines.push(serializePersonaField('background', background))
    if (opening) lines.push(serializePersonaField('opening', opening))
    return lines.join('\n')
  }

  // 自由文本：主体去掉附加行后保留/替换，再追加背景与开场白
  const base = dropPersonaFields(persona, ['background', 'opening', 'nickname'])
  const personality = edits.personality !== undefined ? edits.personality.trim() : base.trim()
  const lines: string[] = []
  if (personality) lines.push(personality)
  if (background) lines.push(serializePersonaField('background', background))
  if (opening) lines.push(serializePersonaField('opening', opening))
  return lines.join('\n')
}
