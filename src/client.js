const name = 'tab-watchdog'
const inject = ['remote', 'uiSession']

const MAX = 24

let entries = new Map()
let head = 0
let seenSeq = 0
let blinking = false
let phase = false
let baseTitle = null
let uiSessionRef = null

const GREEN = '\uD83D\uDFE2'
const YELLOW = '\uD83D\uDFE1'
const SEP = ' \u00B7 '
const UI_PREFIX = 'ui:'

function hasDoc() {
  return typeof document !== 'undefined'
}

function isFocused() {
  if (!hasDoc()) return true
  return document.visibilityState === 'visible' && document.hasFocus()
}

function setTitle(value) {
  if (hasDoc()) document.title = value
}

function sessionKeys(sessionId) {
  if (sessionId === null || sessionId === undefined) return []
  const out = []
  for (const key of entries.keys()) {
    if (key.length > sessionId.length && key.endsWith(':' + sessionId)) out.push(key)
  }
  return out
}

function hasYellowFor(sessionId) {
  for (const key of sessionKeys(sessionId)) {
    const item = entries.get(key)
    if (item !== undefined && item.level === 'yellow') return true
  }
  return false
}

function bump(key, level, label, sessionId) {
  head += 1
  const prev = entries.get(key)
  if (prev !== undefined) {
    prev.seq = head
    prev.level = level
    prev.label = label
    if (sessionId) prev.sessionId = sessionId
    return
  }
  if (entries.size >= MAX) {
    let oldestKey
    let oldestSeq = Infinity
    for (const [k, item] of entries) {
      if (item.seq < oldestSeq) {
        oldestSeq = item.seq
        oldestKey = k
      }
    }
    if (oldestKey !== undefined) entries.delete(oldestKey)
  }
  entries.set(key, { key, level, label, seq: head, sessionId: sessionId ?? null })
}

function dropSession(sessionId) {
  for (const key of sessionKeys(sessionId)) entries.delete(key)
}

function pendingItems() {
  const out = []
  for (const item of entries.values()) {
    if (item.seq > seenSeq) out.push(item)
  }
  return out
}

function countsOf(list) {
  let green = 0
  let yellow = 0
  for (const item of list) {
    if (item.level === 'green') green += 1
    else yellow += 1
  }
  return { green, yellow }
}

function prefixOf(list) {
  const counts = countsOf(list)
  const parts = []
  if (counts.green > 0) parts.push(GREEN + counts.green)
  if (counts.yellow > 0) parts.push(YELLOW + counts.yellow)
  return parts.length > 0 ? parts.join(' ') + SEP : ''
}

function labelOf(interaction) {
  if (!interaction || typeof interaction !== 'object') return 'Richiede la tua attenzione'
  const kind = interaction.kind
  if (kind === 'approval') {
    const tool = interaction.toolName ? ' · ' + String(interaction.toolName).slice(0, 30) : ''
    return 'Richiede approvazione' + tool
  }
  if (kind === 'plan-review') return 'Chiede una risposta (piano)'
  if (kind === 'question') return 'Chiede una risposta'
  return 'Richiede la tua attenzione'
}

function stopBlink() {
  if (!blinking) return
  blinking = false
  phase = false
  if (baseTitle !== null) setTitle(baseTitle)
  baseTitle = null
}

function tickBlink() {
  if (!blinking) return
  phase = !phase
  setTitle((phase ? prefixOf(pendingItems()) : '') + (baseTitle ?? ''))
}

function syncUiPending() {
  try {
    const uiSession = uiSessionRef
    const snap = uiSession && uiSession.pendingInteractions
      ? uiSession.pendingInteractions.getSnapshot()
      : undefined
    const desired = snap !== undefined && snap !== null && typeof snap.get === 'function'
      ? snap
      : undefined
    const wanted = new Set()
    if (desired !== undefined) {
      for (const [sessionId, interaction] of desired) {
        if (!sessionId) continue
        const sid = String(sessionId)
        wanted.add(sid)
        bump(UI_PREFIX + sid, 'yellow', labelOf(interaction), sid)
      }
    }
    for (const key of Array.from(entries.keys())) {
      if (key.startsWith(UI_PREFIX) && !wanted.has(key.slice(UI_PREFIX.length))) {
        entries.delete(key)
      }
    }
  } catch (error) {}
}

function evaluate() {
  syncUiPending()
  if (isFocused()) {
    seenSeq = head
    stopBlink()
    return
  }
  if (pendingItems().length > 0) {
    if (!blinking) {
      blinking = true
      phase = false
      baseTitle = hasDoc() ? document.title : ''
    }
    tickBlink()
  } else {
    stopBlink()
  }
}

function apply(ctx) {
  uiSessionRef = ctx.get && typeof ctx.get === 'function' ? (ctx.get('uiSession') || undefined) : (ctx.uiSession || undefined)

  ctx.effect(() => {
    const offStatus = ctx.remote.$on('api-session/status', (sessionId, running) => {
      if (!sessionId) return
      if (running === false) {
        if (!hasYellowFor(sessionId)) bump('fin:' + sessionId, 'green', 'Ha finito il giro di lavoro', sessionId)
      } else if (running === true) {
        dropSession(sessionId)
      }
      evaluate()
    })
    const offError = ctx.remote.$on('api-session/error', (sessionId, message) => {
      if (sessionId) bump('err:' + sessionId, 'yellow', String(message ?? 'Errore').slice(0, 80), sessionId)
      evaluate()
    })
    const timer = hasDoc() ? window.setInterval(evaluate, 1000) : null
    return () => {
      offStatus()
      offError()
      if (timer !== null) window.clearInterval(timer)
      stopBlink()
    }
  }, 'tab-watchdog: watchers')

  if (hasDoc()) {
    const wake = () => { if (isFocused()) evaluate() }
    ctx.effect(() => {
      document.addEventListener('visibilitychange', wake)
      window.addEventListener('focus', wake)
      return () => {
        document.removeEventListener('visibilitychange', wake)
        window.removeEventListener('focus', wake)
      }
    }, 'tab-watchdog: visibility')
  }
}

module.exports = { name, inject, apply }
