export const name = 'tab-watchdog'

export function apply(ctx) {
  ctx.effect(() => {
    return () => {}
  }, 'tab-watchdog: host presence')
}
