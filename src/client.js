const React = require('react')

const name = 'tab-watchdog'
const inject = ['remote', 'slots']

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

function summaryOf(list) {
  return list.slice(0, 4).map((item) => {
    const tail = item.sessionId ? ' (' + String(item.sessionId).slice(0, 8) + ')' : ''
    return item.label + tail
  }).join(' | ')
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

function ackAll() {
  seenSeq = head
  stopBlink()
}

function WatchdogChip() {
  const [, force] = React.useState(0)
  React.useEffect(() => {
    const timer = window.setInterval(() => force((count) => count + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const items = pendingItems()
  const counts = countsOf(items)
  const hint = (counts.green + counts.yellow) > 0 ? '\u25CF ' + summaryOf(items) : 'watchdog attivo'
  const rowStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: 1 }
  const chipStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 6px', borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2)',
    color: 'var(--dsw-alias-label-secondary)',
    background: 'var(--dsw-alias-bg-base)',
  }
  const btnStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    padding: '2px 7px', borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-alias-bg-float)',
    color: 'var(--dsw-alias-label-primary)',
    cursor: 'pointer', fontSize: 12, lineHeight: 1.3,
  }
  return React.createElement('div', { style: rowStyle, title: hint },
    React.createElement('span', { style: chipStyle },
      React.createElement('span', null, GREEN + counts.green),
      React.createElement('span', null, YELLOW + counts.yellow)),
    React.createElement('button', {
      type: 'button', style: btnStyle,
      onClick: () => { ackAll() },
      title: 'Azzera le segnalazioni pendenti',
    }, '\u2713'))
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
    const passive = (kind, request, next) => {
      try {
        const agent = request && request.agent
        const id = agent && agent.id
        if (id) {
          bump(kind + ':' + id, 'yellow',
            kind === 'ask' ? 'Chiede una risposta' : 'Richiede approvazione', id)
        }
      } catch (error) {}
      return next()
    }
    const offAsk = ctx.remote.$on('user-questions/request', (request, next) => passive('ask', request, next))
    const offApproval = ctx.remote.$on('approval/request', (request, next) => passive('approval', request, next))
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

  try {
    if (ctx.slots) {
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: name,
        order: 50,
      }, WatchdogChip))
    }
  } catch (error) {}
}

module.exports = { name, inject, apply }
