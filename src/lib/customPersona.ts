// 自定义人设 · 结构化表单拼接（纯函数，可 Node 单测）
// 表单只是 UI 层拆分：前端把四个字段拼成一段完整 persona 文本，依旧只存 ai_companion_persona 单字段。
// 不新增存储字段、不碰后端。性格必填的校验交给 UI 层，拼接函数本身不抛错。

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
  if (nickname) lines.push(`角色昵称：${nickname}`)
  if (personality) lines.push(`性格特质：${personality}`)
  if (background) lines.push(`关系背景：${background}`)
  if (opening) lines.push(`初次见面开场白：${opening}`)
  return lines.join('\n')
}

/**
 * 从 persona 文本里解析「初次见面开场白：xxx」这一行的内容（开场白机制用）。
 * 没有这一行或内容为空 → 返回空串。
 */
export function extractOpeningLine(persona: string): string {
  if (!persona) return ''
  // 容忍行首空白（高级编辑可能贴进来的文本带缩进），只要这行以「初次见面开场白：」开头就算
  const m = persona.match(/^\s*初次见面开场白：(.+)$/m)
  return m ? m[1].trim() : ''
}

/**
 * 自定义表单是否有效：性格特质 trim 后非空。
 * 校验只做「能不能确认」，不做长度上限（所有输入框不做字符上限）。
 */
export function isCustomPersonaValid(input: { personality?: string }): boolean {
  return (input.personality ?? '').trim() !== ''
}
