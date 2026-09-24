import { execFileSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

function resolveBuildVersion(): string {
  const envVersion = [
    process.env.GITHUB_SHA,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.CF_PAGES_COMMIT_SHA,
    process.env.RENDER_GIT_COMMIT,
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.SOURCE_VERSION,
    process.env.COMMIT_SHA,
  ].find((value) => typeof value === 'string' && value.trim())

  if (envVersion) return envVersion.trim()

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    // 极少数构建环境不带 .git / commit env：仍保证同一次 build 的 JS 与 version.json 使用同一值。
    return `build-${new Date().toISOString()}`
  }
}

function buildVersionAsset(version: string): Plugin {
  return {
    name: 'eluvin-build-version',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version })}\n`,
      })
    },
  }
}

// 图标缓存破口：iOS 把 apple-touch-icon 存 4 小时，重新「添加到主屏幕」也可能拿到旧图。
// 给图标 URL 带上构建指纹，每次构建都是新地址，系统必定重新抓。
const iconVersion = buildVersionSlice()

function buildVersionSlice(): string {
  const v = resolveBuildVersion()
  return v.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8)
}

function iconCacheBust(version: string): Plugin {
  const suffix = `?v=${version}`
  return {
    name: 'eluvin-icon-cache-bust',
    transformIndexHtml(html: string) {
      return html
        .replace('/brand/apple-eluvin-180.png', `/brand/apple-eluvin-180.png${suffix}`)
        .replace('/brand/favicon-eluvin.png', `/brand/favicon-eluvin.png${suffix}`)
    },
  }
}

const buildVersion = resolveBuildVersion()

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages 相对路径部署
  base: './',
  define: {
    __ELUVIN_BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  build: {
    // 关闭 sourcemap：生产环境不暴露源码，配合混淆降低逆向可读性
    sourcemap: false,
  },
  plugins: [
    react(),
    buildVersionAsset(buildVersion),
    iconCacheBust(iconVersion),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['brand/pwa-eluvin-192.png', 'brand/pwa-eluvin-512.png', 'brand/apple-eluvin-180.png'],
      manifest: {
        name: '忆文·Eluvin',
        short_name: '忆文·Eluvin',
        description: '忆过往，成文思。记得住你，也帮得上你。',
        lang: 'zh-CN',
        theme_color: '#FF8A5C',
        background_color: '#FFF8F3',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          {
            src: `brand/pwa-eluvin-192.png?v=${iconVersion}`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `brand/pwa-eluvin-512.png?v=${iconVersion}`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `brand/pwa-eluvin-maskable-512.png?v=${iconVersion}`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,png}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
})
