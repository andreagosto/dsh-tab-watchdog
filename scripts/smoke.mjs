import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'lib', 'client.js'), 'utf8')

const state = { focused: true, title: 'DeepSeek Web' }
const pendingMap = new Map()
const listeners = {}
const favicon = { href: '/favicon.svg' }

let registration
const sandbox = {
  window: {
    __ModuleLoader__: { load: (reg) => { registration = reg } },
    addEventListener: (type, fn) => { (listeners['w:' + type] ??= []).push(fn) },
    removeEventListener: (type, fn) => {
      listeners['w:' + type] = (listeners['w:' + type] ?? []).filter((f) => f !== fn)
    },
    setInterval: (fn) => { sandbox.window.tick = fn; return 1 },
    clearInterval: () => {},
  },
  document: {
    get title() { return state.title },
    set title(v) { state.title = v },
    visibilityState: 'visible',
    hasFocus: () => state.focused,
    querySelector: (sel) => (sel.includes('icon') ? favicon : null),
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn) },
    removeEventListener: (type, fn) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn)
    },
  },
}
vm.createContext(sandbox)
vm.runInContext(source, sandbox)
if (!registration) throw new Error('smoke: nessuna registrazione __ModuleLoader__')

const uiSessionStub = {
  pendingInteractions: { getSnapshot: () => pendingMap, subscribe: () => () => {} },
}
const remoteStub = {
  $on: (event, handler) => {
    handlers[event] = handler
    return () => { delete handlers[event] }
  },
}
let handlers = {}
let effectCleanups = []
const ctxStub = {
  uiSession: uiSessionStub,
  remote: remoteStub,
  get: (name) => (name === 'uiSession' ? uiSessionStub : undefined),
  effect: (fn) => { effectCleanups.push(fn()) },
}

let passed = 0
const assert = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); process.exit(1) }
  passed += 1
  console.log('ok -', msg)
}

const plugin = registration.factory(() => ({}))
const run = (name, ...args) => handlers[name](...args)
const fireWindow = (type) => { for (const fn of listeners['w:' + type] ?? []) fn() }
const tick = () => { if (sandbox.window.tick) sandbox.window.tick() }
const hide = () => { state.focused = false }
const show = () => {
  state.focused = true
  for (const fn of listeners['visibilitychange'] ?? []) fn()
  for (const fn of listeners['w:focus'] ?? []) fn()
}
const whale = () => favicon.href.startsWith('data:image/svg+xml')
const whaleColor = () => {
  if (!whale()) return ''
  const hex = favicon.href.match(/%23([0-9a-f]{6})/i)
  return hex ? hex[1] : ''
}
const titlePrefixed = () => state.title !== 'DeepSeek Web' && state.title.includes('\u00B7')
const blinked = () => {
  for (let i = 0; i < 5; i += 1) {
    if (whale() || titlePrefixed()) return true
    tick()
  }
  return whale() || titlePrefixed()
}

plugin.apply(ctxStub)

const baseTitle = 'DeepSeek Web'
assert(state.title === baseTitle, 'titolo iniziale invariato')
assert(typeof handlers['api-session/status'] === 'function', 'osserva api-session/status')
assert(typeof handlers['api-session/error'] === 'function', 'osserva api-session/error')
assert(handlers['user-questions/request'] === undefined, 'non osserva i waterfall user-questions/approval')
assert(handlers['approval/request'] === undefined, 'niente listener waterfall approval')
assert(!whale(), 'favicon iniziale non toccata')

// verde: sessione che finisce da nascosto
hide()
run('api-session/status', 'session-1', false)
assert(blinked(), 'round finito da nascosto avvia il lampeggio')
assert(whaleColor() === '22c55e', 'la balena lampeggia VERDE per esito finale')
show()
assert(state.title === baseTitle, 'ritorno al focus ripristina il titolo')
assert(favicon.href === '/favicon.svg', 'ritorno al focus ripristina la favicon originale')

// giallo: approvazione pendente dalla UI
hide()
pendingMap.set('session-1', { kind: 'approval', toolName: 'bash', sessionId: 'session-1' })
tick()
assert(whaleColor() === 'eab308', 'approvazione pendente: la balena lampeggia GIALLA')
pendingMap.clear()
tick()
assert(!whale() && state.title === baseTitle, 'approvazione risolta: lampeggio si ferma e tutto torna base')
show()

// giallo: domanda su altra sessione
hide()
pendingMap.set('session-2', { kind: 'question', sessionId: 'session-2' })
tick()
assert(whaleColor() === 'eab308', 'domanda pendente: la balena lampeggia GIALLA')
pendingMap.clear()
tick()
assert(!whale(), 'domanda risolta: si ferma')
show()

// verde + giallo insieme: alterna le due balene
hide()
pendingMap.set('session-2', { kind: 'question', sessionId: 'session-2' })
run('api-session/status', 'session-1', false)
let sawGreen = false
let sawYellow = false
for (let i = 0; i < 10; i += 1) {
  tick()
  const color = whaleColor()
  if (color === '22c55e') sawGreen = true
  if (color === 'eab308') sawYellow = true
  if (sawGreen && sawYellow) break
}
assert(sawGreen && sawYellow, 'verde+giallo insieme: le balene alternano i colori')
pendingMap.clear()
show()
assert(favicon.href === '/favicon.svg', 'focus finale ripristina la favicon originale')

for (const cleanup of effectCleanups) cleanup()
console.log(`\n[smoke] OK — ${passed} asserzioni superate`)
