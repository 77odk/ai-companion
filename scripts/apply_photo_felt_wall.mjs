import fs from 'node:fs'

const path = 'src/index.css'
let css = fs.readFileSync(path, 'utf8')
const marker = '/* ===== UI2-04 Card 2：Space 照片墙 · felt wall ===== */'
if (css.includes(marker)) throw new Error('photo felt-wall styles already exist')

css += `

${marker}
/* 只改 Space 首页的照片呈现；上传、数据源、lightbox 继续沿用现有逻辑。 */
.space-archive-home .ai-photo-grid {
  position: relative;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 12px;
  padding: 18px 14px 16px;
  border-radius: 22px;
  background:
    radial-gradient(
      circle at 1px 1px,
      color-mix(in srgb, var(--color-text-muted) 10%, transparent) 0.7px,
      transparent 0.8px
    ) 0 0 / 7px 7px,
    color-mix(in srgb, var(--color-primary-soft) 22%, var(--color-card));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-border) 72%, transparent);
  overflow: visible;
}

.space-archive-home .ai-photo-cell {
  aspect-ratio: 4 / 3;
  padding: 5px 5px 22px;
  border: none;
  border-radius: 5px;
  overflow: hidden;
  background: var(--color-card);
  box-shadow: 0 5px 14px color-mix(in srgb, var(--color-text) 11%, transparent);
  transform: rotate(-0.55deg);
  transform-origin: center;
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}

.space-archive-home .ai-photo-cell:nth-child(3n + 2) {
  transform: rotate(0.65deg);
}

.space-archive-home .ai-photo-cell:nth-child(3n) {
  transform: rotate(-0.2deg);
}

.space-archive-home .ai-photo-cell:nth-child(5n + 1) {
  grid-column: 1 / -1;
  aspect-ratio: 16 / 9;
}

.space-archive-home .ai-photo-cell:active {
  transform: rotate(0deg) scale(0.985);
  box-shadow: 0 3px 9px color-mix(in srgb, var(--color-text) 9%, transparent);
}

.space-archive-home .ai-photo-img {
  border-radius: 2px;
}

.space-archive-home .ai-photo-date {
  left: 8px;
  right: 8px;
  bottom: 5px;
  color: var(--color-text-muted);
  text-shadow: none;
  font-size: 10px;
  line-height: 1.2;
  letter-spacing: 0.02em;
  text-align: right;
}

.space-archive-home .ai-photo-cell.ai-photo-uploading {
  padding: 0;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-primary-soft) 20%, var(--color-card));
  box-shadow: none;
  transform: none;
}

.space-archive-home .ai-photo-add-more {
  display: block;
  width: fit-content;
  margin: 9px 2px 0 auto;
  padding: 5px 1px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 500;
}

.space-archive-home .ai-photo-add-more:active {
  color: var(--color-primary-deep);
}

.space-archive-home .ai-space-photo-add {
  min-height: 168px;
  padding: 28px 20px;
  border: none;
  border-radius: 22px;
  background:
    radial-gradient(
      circle at 1px 1px,
      color-mix(in srgb, var(--color-text-muted) 10%, transparent) 0.7px,
      transparent 0.8px
    ) 0 0 / 7px 7px,
    color-mix(in srgb, var(--color-primary-soft) 22%, var(--color-card));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-border) 72%, transparent);
}

.space-archive-home .ai-space-photo-add svg {
  width: 28px;
  height: 28px;
  padding: 6px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-card) 82%, transparent);
  color: var(--color-primary-deep);
  box-sizing: content-box;
}

.space-archive-home .ai-space-photo-add p {
  margin: 0;
  max-width: 230px;
  font-size: 13px;
  line-height: 1.65;
  color: var(--color-text-muted);
}

@media (max-width: 360px) {
  .space-archive-home .ai-photo-grid {
    gap: 12px 10px;
    padding: 15px 12px 14px;
  }

  .space-archive-home .ai-photo-cell {
    padding: 4px 4px 20px;
  }
}
`

fs.writeFileSync(path, css)
console.log('photo felt-wall styles appended')
