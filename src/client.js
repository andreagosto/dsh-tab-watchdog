const name = 'tab-watchdog'
const inject = ['remote', 'sessions']

const MAX = 24

let entries = new Map()
let head = 0
let seenSeq = 0
let blinking = false
let phase = false
let baseTitle = null

const GREEN = '\uD83D\uDFE2'
const YELLOW = '\uD83D\uDFE1'
const SEP = ' \u00B7 '

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

function evaluate() {
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
    const sessionScopeOf = (owner) => {
      try {
        const sessions = ctx.sessions
        if (sessions && typeof sessions.scopeOf === 'function') {
          const value = sessions.scopeOf(owner)
          if (value) return String(value)
        }
      } catch (error) {}
      return undefined
    }
    const passive = (kind, owner, request, next) => {
      try {
        const sessionId = sessionScopeOf(owner) || (request && request.agent && request.agent.id) || undefined
        if (sessionId) {
          bump(kind + ':' + sessionId, 'yellow',
            kind === 'ask' ? 'Chiede una risposta' : 'Richiede approvazione', sessionId)
        }
      } catch (error) {}
      return next()
    }
    const offAsk = ctx.remote.$on('user-questions/request', function (request, next) {
      return passive('ask', this, request, next)
    })
    const offApproval = ctx.remote.$on('approval/request', function (request, next) {
      return passive('approval', this, request, next)
    })
    const timer = hasDoc() ? window.setInterval(evaluate, 1000) : null
    return () => {
      offStatus()
      offError()
      offAsk()
      offApproval()
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
