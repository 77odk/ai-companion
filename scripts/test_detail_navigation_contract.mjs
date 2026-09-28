// Detail navigation + top-bar contract: flat back affordance, true centered title, return to real source.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const primitives = fs.readFileSync(new URL('../src/styles/primitives.css', import.meta.url), 'utf8')
const notifications = fs.readFileSync(new URL('../src/components/NotificationsPage.tsx', import.meta.url), 'utf8')
const settings = fs.readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

assert.match(primitives, /\.detail-header\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/)
assert.match(primitives, /\.detail-back\s*\{[\s\S]*border:\s*0;[\s\S]*background:\s*transparent;/)
assert.match(primitives, /\.detail-title\s*\{[\s\S]*grid-column:\s*2;[\s\S]*text-align:\s*center;/)
assert.match(notifications, /<h2 className="detail-title">消息与通知<\/h2>/)
assert.match(notifications, /className="detail-spacer"/)

assert.match(settings, /onInitialPageBack\?: \(\) => void/)
assert.match(settings, /initialPage === current && onInitialPageBack/)
assert.match(settings, /ProviderDetail onBack=\{\(\) => backFrom\('provider'\)\}/)
assert.match(app, /initialPage=\{settingsTarget\}[\s\S]*onInitialPageBack=\{\(\) => window\.history\.back\(\)\}/)

// Independent detail views entered through goView/navigate return through browser history,
// preserving the exact entry source instead of hard-coding a destination.
assert.match(app, /<ProductIntro onBack=\{\(\) => window\.history\.back\(\)\}/)
assert.match(app, /<RolesPage[\s\S]*onBack=\{\(\) => window\.history\.back\(\)\}/)
assert.match(app, /<ChatSettings[\s\S]*onBack=\{\(\) => window\.history\.back\(\)\}/)
assert.match(app, /<AboutMe onBack=\{\(\) => window\.history\.back\(\)\}/)
assert.match(app, /<WeeklyPage onBack=\{\(\) => window\.history\.back\(\)\}/)
assert.match(app, /<SpaceLife[\s\S]*onBack=\{\(\) => window\.history\.back\(\)\}/)
assert.match(app, /const handleGuideBack = \(\) => \{[\s\S]*if \(guideBack === 'gate'\)[\s\S]*window\.history\.back\(\)/)

console.log('detail navigation contract: PASS')
