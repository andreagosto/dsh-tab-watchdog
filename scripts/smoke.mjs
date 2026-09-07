import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'lib', 'client.js'), 'utf8')

const state = { focused: true, title: 'DeepSeek Web' }
const pendingMap = new Map()
const listeners = {}

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
  pendingInteractions: {
    getSnapshot: () => pendingMap,
    subscribe: () => () => {},
  },
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
const hasBadge = (title) => title.includes('\uD83D\uDFE2') || title.includes('\uD83D\uDFE1')
const blinkOn = () => {
  for (let i = 0; i < 4; i += 1) {
    if (hasBadge(state.title)) return true
    if (sandbox.window.tick) sandbox.window.tick()
  }
  return hasBadge(state.title)
}
const tick = () => { if (sandbox.window.tick) sandbox.window.tick() }
const hide = () => { state.focused = false }
const show = () => {
  state.focused = true
  for (const fn of listeners['visibilitychange'] ?? []) fn()
  for (const fn of listeners['w:focus'] ?? []) fn()
}
const run = (name, ...args) => handlers[name](...args)

plugin.apply(ctxStub)

const baseTitle = 'DeepSeek Web'
assert(state.title === baseTitle, 'titolo iniziale invariato')
assert(typeof handlers['api-session/status'] === 'function', 'osserva api-session/status')
assert(typeof handlers['api-session/error'] === 'function', 'osserva api-session/error')
assert(handlers['user-questions/request'] === undefined, 'non osserva piu i waterfall user-questions/approval')
assert(handlers['approval/request'] === undefined, 'niente listener waterfall approval')

// verde: sessione che finisce da nascosto
hide()
run('api-session/status', 'session-1', false)
assert(blinkOn() && state.title.includes('\uD83D\uDFE2'), 'sessione finita da nascosto lampeggia verde')
show()
assert(state.title === baseTitle, 'ritorno al focus ripristina il titolo')

// giallo: interazione pendente pubblicata dalla UI (approval)
hide()
pendingMap.set('session-1', { kind: 'approval', toolName: 'bash', sessionId: 'session-1' })
tick()
assert(blinkOn() && state.title.includes('\uD83D\uDFE1'), 'approval pendente da nascosto lampeggia giallo')
assert(blinkOn(), 'il lampeggio continua finche l interazione resta pendente')

// risposta: la UI rimuove il pendente -> si ferma
pendingMap.clear()
tick()
assert(state.title === baseTitle, 'interazione risolta: lampeggio si ferma e titolo torna base')

// giallo: domanda (kind question) su un altra sessione
pendingMap.set('session-2', { kind: 'question', sessionId: 'session-2' })
tick()
assert(blinkOn() && state.title.includes('\uD83D\uDFE1'), 'domanda pendente da nascosto lampeggia giallo')
pendingMap.clear()
tick()
assert(state.title === baseTitle, 'domanda risolta: si ferma')
show()

// errore ancora funzionante
hide()
run('api-session/error', 'session-3', 'boom')
assert(blinkOn() && state.title.includes('\uD83D\uDFE1'), 'errore da nascosto lampeggia giallo')
show()
assert(state.title === baseTitle, 'focus dopo errore ripristina il titolo')

for (const cleanup of effectCleanups) cleanup()
console.log(`\n[smoke] OK — ${passed} asserzioni superate`)
