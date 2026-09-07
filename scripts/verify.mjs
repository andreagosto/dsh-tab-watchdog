import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const source = await readFile(join(root, 'lib', 'client.js'), 'utf8')

let registration
vm.runInNewContext(source, { window: { __ModuleLoader__: { load: (reg) => { registration = reg } } } })

if (!registration) throw new Error('verify: il bundle non ha chiamato window.__ModuleLoader__.load')
if (registration.id !== pkg.name) throw new Error(`verify: id atteso ${pkg.name}, trovato ${registration.id}`)
if (typeof registration.factory !== 'function') throw new Error('verify: factory non è una funzione')

const fakeRequire = (spec) => {
  if (spec === 'react') return {}
  throw new Error(`verify: richiesto modulo non previsto "${spec}"`)
}

const output = registration.factory(fakeRequire)
const plugin = output
if (!plugin || typeof plugin !== 'object') throw new Error('verify: plugin non è un oggetto')
if (plugin.name !== 'tab-watchdog') throw new Error('verify: name inatteso')
if (!Array.isArray(plugin.inject)) throw new Error('verify: inject mancante')
if (typeof plugin.apply !== 'function') throw new Error('verify: apply mancante')

const expected = ['remote', 'slots']
if (JSON.stringify([...plugin.inject].sort()) !== JSON.stringify([...expected].sort())) {
  throw new Error(`verify: inject inatteso ${JSON.stringify(plugin.inject)}`)
}

console.log('[verify] OK — id=' + registration.id + ', inject=[' + plugin.inject.join(', ') + '], apply=fn')
