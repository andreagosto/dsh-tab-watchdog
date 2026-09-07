import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const body = await readFile(join(root, 'src', 'client.js'), 'utf8')

const artifact = [
  'window.__ModuleLoader__.load({',
  `  id: ${JSON.stringify(pkg.name)},`,
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  body.replace(/\n$/, ''),
  '    return module.exports;',
  '  }',
  '});',
  '',
].join('\n')

await writeFile(join(root, 'lib', 'client.js'), artifact)
console.log(`[build] wrote lib/client.js (${artifact.split('\n').length} lines, id=${pkg.name})`)
