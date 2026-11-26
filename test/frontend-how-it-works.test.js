const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')
const frontendRoot = path.join(repoRoot, 'package/frontend')

test('frontend package exposes the documented Next.js plus custom server scripts', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(frontendRoot, 'package.json'), 'utf8')
  )

  assert.equal(packageJson.scripts.dev, 'next dev')
  assert.equal(packageJson.scripts.build, 'next build')
  assert.equal(packageJson.main, 'server.js')
  assert.equal(packageJson.scripts.start, 'node server.js')
})

test('how-it-works page keeps key workflow copy blocks', () => {
  const pageSource = fs.readFileSync(
    path.join(frontendRoot, 'app', 'page.tsx'),
    'utf8'
  )

  assert.match(pageSource, /How it works/)
  assert.match(pageSource, /Execute mode/)
  assert.match(pageSource, /Prompt the agent/)
  assert.match(pageSource, /Next step/)
})
