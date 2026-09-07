import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(root, 'lib', 'client.js'), 'utf8')

const state = { focused: true, title: 'DeepSeek Web' }
const owners = new Map()
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

const sessionOf = (owner) => { const id = owners.get(owner); return id ? 'session-' + id : undefined }

let effectCleanups = []
let handlers = {}
const ctxStub = {
  slots: undefined,
  sessions: { scopeOf: sessionOf },
  remote: {
    $on: (event, handler) => {
      handlers[event] = handler
      return () => { delete handlers[event] }
    },
  },
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
const runScoped = (name, owner, ...args) => handlers[name].call(owner, ...args)
const fire = (type) => { for (const fn of listeners[type] ?? []) fn() }
const fireWindow = (type) => { for (const fn of listeners['w:' + type] ?? []) fn() }
const hasBadge = (title) => title.includes('\uD83D\uDFE2') || title.includes('\uD83D\uDFE1')
const blinkOn = () => {
  for (let i = 0; i < 4; i += 1) {
    if (hasBadge(state.title)) return true
    if (sandbox.window.tick) sandbox.window.tick()
  }
  return hasBadge(state.title)
}

plugin.apply(ctxStub)

const baseTitle = 'DeepSeek Web'
assert(state.title === baseTitle, 'titolo iniziale invariato')
assert(typeof handlers['api-session/status'] === 'function', 'osserva api-session/status')
assert(typeof handlers['api-session/error'] === 'function', 'osserva api-session/error')
assert(typeof handlers['user-questions/request'] === 'function', 'osserva user-questions/request')
assert(typeof handlers['approval/request'] === 'function', 'osserva approval/request')

let nextCalls = 0
const ownerAsk = { id: 'agent-1' }
owners.set(ownerAsk, 'agent-1')
runScoped('user-questions/request', ownerAsk, { questions: [] }, () => { nextCalls += 1 })
assert(nextCalls === 1, 'observer user-questions passivo chiama next() senza consumare')
state.focused = false
if (sandbox.window.tick) sandbox.window.tick()
assert(hasBadge(state.title), 'domanda (scoped via sessions.scopeOf) genera un pendente da nascosto')
state.focused = true
state.title = baseTitle
owners.clear()
nextCalls = 0
const ownerScopeless = { id: 'orphan' }
runScoped('user-questions/request', ownerScopeless, { questions: [] }, () => { nextCalls += 1 })
assert(nextCalls === 1, 'senza sessione risolvibile resta passivo (nessun pendente)')
assert(state.title === baseTitle, 'senza sessione non si creano pendenti')
state.title = baseTitle
owners.clear()

state.focused = false
run('api-session/status', 'session-1', false)
assert(blinkOn(), 'sessione finita mentre nascosto avvia il lampeggio (badge nel titolo)')

run('api-session/error', 'session-1', 'boom')
assert(blinkOn(), 'errore sulla sessione lascia pendente il lampeggio')

state.focused = true
fireWindow('focus')
assert(state.title === baseTitle, 'ritorno al focus ripristina il titolo originale')
assert(!blinkOn(), 'niente badge dopo il ritorno al focus')

run('api-session/status', 'session-1', false)
assert(state.title === baseTitle, 'evento mentre focalizzato non lascia pendenti')

state.focused = false
if (sandbox.window.tick) sandbox.window.tick()
run('api-session/error', 'session-2', 'altro guasto')
assert(blinkOn(), 'nuovo errore mentre nascosto riavvia il lampeggio')

state.focused = true
fire('visibilitychange')
assert(state.title === baseTitle, 'secondo ritorno ripristina di nuovo il titolo')

run('api-session/status', 'session-3', true)
state.focused = false
if (sandbox.window.tick) sandbox.window.tick()
assert(!blinkOn(), 'sessione che riparte (running=true) non lascia segnalazioni')

for (const cleanup of effectCleanups) cleanup()
console.log(`\n[smoke] OK — ${passed} asserzioni superate`)
