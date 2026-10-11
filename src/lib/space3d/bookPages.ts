import type { StoredMessage } from '../storage'
import type { ReadingPosition } from '../environmentPreferences'

export interface PageFragment { messageId: string; offset: number; text: string }
export interface BookPage { text: string; fragments: PageFragment[] }
/** Old messages lack server IDs: a stable, read-only identity, never written back. */
export function messageIdentity(message: StoredMessage): string {
  if (message.id != null) return `id:${message.id}`
  let hash = 2166136261
  for (const character of message.content) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619)
  return `local:${message.role}:${message.ts}:${hash >>> 0}`
}
export function paginateMessages(messages: StoredMessage[], size = 320): BookPage[] {
  if (size < 250 || size > 400) throw new RangeError('Page capacity must be 250–400 characters')
  const pages: BookPage[] = []
  let page: BookPage = { text: '', fragments: [] }
  for (const message of messages) {
    const messageId = messageIdentity(message)
    const characters = Array.from(message.content)
    let offset = 0
    while (offset < characters.length) {
      const text = characters.slice(offset, offset + size - Array.from(page.text).length).join('')
      page.fragments.push({ messageId, offset, text })
      page.text += text
      offset += Array.from(text).length
      if (Array.from(page.text).length === size) { pages.push(page); page = { text: '', fragments: [] } }
    }
  }
  if (page.text) pages.push(page)
  return pages
}
export function pageForPosition(pages: BookPage[], position?: ReadingPosition): number {
  if (!position) return 0
  const index = pages.findIndex(page => page.fragments.some(fragment => fragment.messageId === position.messageId
    && position.offset >= fragment.offset && position.offset < fragment.offset + Array.from(fragment.text).length))
  return Math.max(0, index)
}
/** 1024×2048 backing; only 1024×1468 is mapped, preserving 0.30m×0.43m page ratio. */
export async function drawBookPage(page?: BookPage): Promise<HTMLCanvasElement> {
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  canvas.width = 1024; canvas.height = 2048
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#F1EBDD'; ctx.fillRect(0, 0, 1024, 2048)
  // A restrained inset and gutter shadow make the page read as paper, not a screen.
  const edge=ctx.createLinearGradient(0,0,100,0)
  edge.addColorStop(0,'rgba(106,83,57,.09)');edge.addColorStop(1,'rgba(106,83,57,0)')
  ctx.fillStyle=edge;ctx.fillRect(0,0,100,1468)
  ctx.fillStyle = '#30271D'
  ctx.font = '600 55px "LXGW WenKai Subset", "Noto Sans CJK SC", "PingFang SC", sans-serif'
  ctx.textBaseline = 'top'
  const characters = Array.from(page?.text ?? '')
  for (let i = 0; i < characters.length; i++) {
    ctx.fillText(characters[i], 70 + (i % 16) * 55, 64 + Math.floor(i / 16) * 66)
  }
  return canvas
}
