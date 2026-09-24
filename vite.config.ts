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
            src: 'brand/pwa-eluvin-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'brand/pwa-eluvin-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'brand/pwa-eluvin-maskable-512.png',
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
