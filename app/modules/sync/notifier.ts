import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'

// In-process notifier — for multi-process, use unstorage with redis cache driver
const emitter = new EventEmitter()
emitter.setMaxListeners(0)

// Track active long-polls per sync connection (userId + connection key)
const activeSyncs = new Map<string, AbortController>()

// Called when events are created (in-process fast path)
export function notifyUser(userId: string) {
  emitter.emit(`notify:${userId}`)
}

// Wait for a notification or timeout, returns true if notified
export function waitForNotification(userId: string, timeoutMs: number): Promise<boolean> {
  // Each concurrent sync gets a unique key (no cancellation of siblings)
  const syncKey = `${userId}:${randomBytes(8).toString('hex')}`

  const controller = new AbortController()
  activeSyncs.set(syncKey, controller)

  return new Promise((resolve) => {
    let resolved = false
    let timer: ReturnType<typeof setTimeout>

    function done(value: boolean) {
      if (resolved)
        return
      resolved = true
      clearTimeout(timer)
      emitter.removeListener(`notify:${userId}`, onNotify)
      controller.signal.removeEventListener('abort', onAbort)
      activeSyncs.delete(syncKey)
      resolve(value)
    }

    function onNotify() {
      done(true)
    }

    function onAbort() {
      done(false)
    }

    timer = setTimeout(() => done(false), timeoutMs)

    controller.signal.addEventListener('abort', onAbort)

    emitter.on(`notify:${userId}`, onNotify)
  })
}
