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
let paperBackground: HTMLCanvasElement | undefined
function paperCanvas(): HTMLCanvasElement {
  if (paperBackground) return paperBackground
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=2048
  const ctx=canvas.getContext('2d')!,pixels=ctx.createImageData(1024,2048)
  let seed=751
  const random=()=>{seed=Math.imul(seed,1664525)+1013904223|0;return (seed>>>0)/4294967296}
  for(let y=0;y<2048;y+=8)for(let x=0;x<1024;x+=8){
    const tone=(random()-.5)*10
    for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++){
      const i=((y+dy)*1024+x+dx)*4,fiber=(random()-.5)*3
      pixels.data[i]=245+tone+fiber;pixels.data[i+1]=240+tone+fiber;pixels.data[i+2]=228+tone+fiber;pixels.data[i+3]=255
    }
  }
  ctx.putImageData(pixels,0,0)
  ctx.strokeStyle='rgba(134,105,65,.10)';ctx.lineWidth=1
  ctx.beginPath()
  for(let i=0;i<14000;i++){
    const x=random()*1024,y=random()*2048;ctx.moveTo(x,y);ctx.lineTo(x+4+random()*14,y+(random()-.5)*5)
  }
  ctx.stroke()
  // Paper ageing is a local pigment detail, not baked directional lighting.
  for(const [x0,y0,x1,y1,x,y,w,h] of [[0,0,42,0,0,0,42,1468],[1024,0,980,0,980,0,44,1468],
    [0,0,0,32,0,0,1024,32],[0,1468,0,1428,0,1428,1024,40]]){
    const edge=ctx.createLinearGradient(x0,y0,x1,y1)
    edge.addColorStop(0,'rgba(174,126,54,.22)');edge.addColorStop(1,'rgba(174,126,54,0)')
    ctx.fillStyle=edge;ctx.fillRect(x,y,w,h)
  }
  paperBackground=canvas;return canvas
}
export async function drawBookPage(page?: BookPage): Promise<HTMLCanvasElement> {
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  canvas.width = 1024; canvas.height = 2048
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(paperCanvas(),0,0)
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
