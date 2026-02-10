/**
 * Lightweight Matrix Client-Server API wrapper using fetch.
 * Zero external dependencies — runs on Bun natively.
 */

export class MatrixClient {
  constructor(
    public baseUrl: string,
    public accessToken: string,
    public userId: string,
  ) {}

  async request(method: string, path: string, body?: unknown): Promise<any> {
    const url = `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
    }
    if (body) {
      headers['Content-Type'] = 'application/json'
    }
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json() as Record<string, unknown>
    if (!res.ok) {
      const err = new Error(`${method} ${path} → ${res.status}: ${json.errcode || json.error || res.statusText}`)
      ;(err as any).status = res.status
      ;(err as any).body = json
      throw err
    }
    return json
  }

  // ---- Sync ----

  async sync(params: { since?: string, timeout?: number, filter?: string } = {}) {
    const qs = new URLSearchParams()
    if (params.since)
      qs.set('since', params.since)
    if (params.timeout !== undefined)
      qs.set('timeout', String(params.timeout))
    if (params.filter)
      qs.set('filter', params.filter)
    const q = qs.toString()
    return this.request('GET', `/_matrix/client/v3/sync${q ? `?${q}` : ''}`)
  }

  // ---- Account ----

  async whoami() {
    return this.request('GET', '/_matrix/client/v3/account/whoami')
  }

  async getProfile(userId: string) {
    return this.request('GET', `/_matrix/client/v3/profile/${encodeURIComponent(userId)}`)
  }

  async setDisplayName(userId: string, displayname: string) {
    return this.request('PUT', `/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`, { displayname })
  }

  async setAvatarUrl(userId: string, avatarUrl: string) {
    return this.request('PUT', `/_matrix/client/v3/profile/${encodeURIComponent(userId)}/avatar_url`, { avatar_url: avatarUrl })
  }

  // ---- Rooms ----

  async createRoom(opts: Record<string, unknown> = {}) {
    return this.request('POST', '/_matrix/client/v3/createRoom', opts)
  }

  async joinRoom(roomIdOrAlias: string) {
    return this.request('POST', `/_matrix/client/v3/join/${encodeURIComponent(roomIdOrAlias)}`)
  }

  async joinedRooms() {
    return this.request('GET', '/_matrix/client/v3/joined_rooms')
  }

  async leaveRoom(roomId: string) {
    return this.request('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`)
  }

  async invite(roomId: string, userId: string) {
    return this.request('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, { user_id: userId })
  }

  async kick(roomId: string, userId: string, reason?: string) {
    return this.request('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/kick`, { user_id: userId, reason })
  }

  async ban(roomId: string, userId: string, reason?: string) {
    return this.request('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/ban`, { user_id: userId, reason })
  }

  async unban(roomId: string, userId: string) {
    return this.request('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/unban`, { user_id: userId })
  }

  async getMembers(roomId: string) {
    return this.request('GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members`)
  }

  // ---- Messages ----

  async sendMessage(roomId: string, txnId: string, content: Record<string, unknown>) {
    return this.request('PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`, content)
  }

  async sendEvent(roomId: string, eventType: string, txnId: string, content: Record<string, unknown>) {
    return this.request('PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${eventType}/${txnId}`, content)
  }

  async editMessage(roomId: string, originalEventId: string, txnId: string, newBody: string) {
    return this.sendMessage(roomId, txnId, {
      'msgtype': 'm.text',
      'body': `* ${newBody}`,
      'm.new_content': { msgtype: 'm.text', body: newBody },
      'm.relates_to': { rel_type: 'm.replace', event_id: originalEventId },
    })
  }

  async getMessages(roomId: string, params: { from?: string, to?: string, dir?: 'b' | 'f', limit?: number } = {}) {
    const qs = new URLSearchParams()
    if (params.from)
      qs.set('from', params.from)
    if (params.to)
      qs.set('to', params.to)
    if (params.dir)
      qs.set('dir', params.dir)
    if (params.limit !== undefined)
      qs.set('limit', String(params.limit))
    const q = qs.toString()
    return this.request('GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages${q ? `?${q}` : ''}`)
  }

  async getEvent(roomId: string, eventId: string) {
    return this.request('GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`)
  }

  async getContext(roomId: string, eventId: string, limit?: number) {
    const qs = limit !== undefined ? `?limit=${limit}` : ''
    return this.request('GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/context/${encodeURIComponent(eventId)}${qs}`)
  }

  async redact(roomId: string, eventId: string, txnId: string, reason?: string) {
    return this.request('PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${txnId}`, { reason })
  }

  // ---- Threads ----

  async sendThreadReply(roomId: string, threadRootId: string, txnId: string, body: string) {
    return this.sendMessage(roomId, txnId, {
      'msgtype': 'm.text',
      'body': body,
      'm.relates_to': {
        'rel_type': 'm.thread',
        'event_id': threadRootId,
        'is_falling_back': true,
        'm.in_reply_to': { event_id: threadRootId },
      },
    })
  }

  async getThreadRoots(roomId: string, params: { include?: string, limit?: number, from?: string } = {}) {
    const qs = new URLSearchParams()
    if (params.include)
      qs.set('include', params.include)
    if (params.limit !== undefined)
      qs.set('limit', String(params.limit))
    if (params.from)
      qs.set('from', params.from)
    const q = qs.toString()
    return this.request('GET', `/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/threads${q ? `?${q}` : ''}`)
  }

  // ---- State ----

  async sendStateEvent(roomId: string, eventType: string, stateKey: string, content: Record<string, unknown>) {
    const skPart = stateKey ? `/${stateKey}` : ''
    return this.request('PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${eventType}${skPart}`, content)
  }

  async getStateEvent(roomId: string, eventType: string, stateKey = '') {
    const skPart = stateKey ? `/${stateKey}` : ''
    return this.request('GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${eventType}${skPart}`)
  }

  // ---- Aliases ----

  async createAlias(alias: string, roomId: string) {
    return this.request('PUT', `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`, { room_id: roomId })
  }

  async resolveAlias(alias: string) {
    return this.request('GET', `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`)
  }

  async deleteAlias(alias: string) {
    return this.request('DELETE', `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`)
  }

  // ---- Typing ----

  async setTyping(roomId: string, userId: string, typing: boolean, timeout = 30000) {
    return this.request('PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(userId)}`, { typing, timeout })
  }

  // ---- Receipts & Read Markers ----

  async sendReceipt(roomId: string, eventId: string, receiptType = 'm.read') {
    return this.request('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/receipt/${receiptType}/${encodeURIComponent(eventId)}`, {})
  }

  async setReadMarker(roomId: string, fullyRead: string, read?: string) {
    const body: Record<string, string> = { 'm.fully_read': fullyRead }
    if (read)
      body['m.read'] = read
    return this.request('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/read_markers`, body)
  }

  // ---- Account Data ----

  async getAccountData(userId: string, type: string) {
    return this.request('GET', `/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${type}`)
  }

  async setAccountData(userId: string, type: string, content: Record<string, unknown>) {
    return this.request('PUT', `/_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${type}`, content)
  }

  async getRoomAccountData(roomId: string, type: string) {
    return this.request('GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/account_data/${type}`)
  }

  async setRoomAccountData(roomId: string, type: string, content: Record<string, unknown>) {
    return this.request('PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/account_data/${type}`, content)
  }

  // ---- E2EE Keys ----

  async uploadKeys(body: Record<string, unknown>) {
    return this.request('POST', '/_matrix/client/v3/keys/upload', body)
  }

  async queryKeys(body: Record<string, unknown>) {
    return this.request('POST', '/_matrix/client/v3/keys/query', body)
  }

  async claimKeys(body: Record<string, unknown>) {
    return this.request('POST', '/_matrix/client/v3/keys/claim', body)
  }

  async getKeyChanges(from: string, to: string) {
    return this.request('GET', `/_matrix/client/v3/keys/changes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
  }

  // ---- Cross-Signing ----

  async uploadCrossSigningKeys(body: Record<string, unknown>) {
    return this.request('POST', '/_matrix/client/v3/keys/device_signing/upload', body)
  }

  async uploadSignatures(body: Record<string, unknown>) {
    return this.request('POST', '/_matrix/client/v3/keys/signatures/upload', body)
  }

  // ---- To-Device ----

  async sendToDevice(eventType: string, txnId: string, messages: Record<string, Record<string, unknown>>) {
    return this.request('PUT', `/_matrix/client/v3/sendToDevice/${eventType}/${txnId}`, { messages })
  }

  // ---- Devices ----

  async getDevices() {
    return this.request('GET', '/_matrix/client/v3/devices')
  }

  async getDevice(deviceId: string) {
    return this.request('GET', `/_matrix/client/v3/devices/${encodeURIComponent(deviceId)}`)
  }

  // ---- Dehydrated Device (MSC3814) ----

  async putDehydratedDevice(body: Record<string, unknown>) {
    return this.request('PUT', '/_matrix/client/unstable/org.matrix.msc3814.v1/dehydrated_device', body)
  }

  async getDehydratedDevice() {
    return this.request('GET', '/_matrix/client/unstable/org.matrix.msc3814.v1/dehydrated_device')
  }

  async deleteDehydratedDevice() {
    return this.request('DELETE', '/_matrix/client/unstable/org.matrix.msc3814.v1/dehydrated_device')
  }

  async getDehydratedDeviceEvents(deviceId: string, nextBatch?: string) {
    return this.request('POST', `/_matrix/client/unstable/org.matrix.msc3814.v1/dehydrated_device/${encodeURIComponent(deviceId)}/events`, nextBatch ? { next_batch: nextBatch } : {})
  }

  // ---- Notifications ----

  async getNotifications(params: { from?: string, limit?: number, only?: string } = {}) {
    const qs = new URLSearchParams()
    if (params.from)
      qs.set('from', params.from)
    if (params.limit !== undefined)
      qs.set('limit', String(params.limit))
    if (params.only)
      qs.set('only', params.only)
    const q = qs.toString()
    return this.request('GET', `/_matrix/client/v3/notifications${q ? `?${q}` : ''}`)
  }

  // ---- Login ----

  async logout() {
    return this.request('POST', '/_matrix/client/v3/logout')
  }

  // ---- Admin ----

  async adminStats() {
    return this.request('GET', '/admin/api/stats')
  }

  async adminUsers(params: { search?: string, limit?: number, offset?: number } = {}) {
    const qs = new URLSearchParams()
    if (params.search)
      qs.set('search', params.search)
    if (params.limit !== undefined)
      qs.set('limit', String(params.limit))
    if (params.offset !== undefined)
      qs.set('offset', String(params.offset))
    const q = qs.toString()
    return this.request('GET', `/admin/api/users${q ? `?${q}` : ''}`)
  }

  async adminUser(userId: string) {
    return this.request('GET', `/admin/api/users/${encodeURIComponent(userId)}`)
  }

  async adminRooms(params: { search?: string, limit?: number, offset?: number } = {}) {
    const qs = new URLSearchParams()
    if (params.search)
      qs.set('search', params.search)
    if (params.limit !== undefined)
      qs.set('limit', String(params.limit))
    if (params.offset !== undefined)
      qs.set('offset', String(params.offset))
    const q = qs.toString()
    return this.request('GET', `/admin/api/rooms${q ? `?${q}` : ''}`)
  }

  async adminTokens() {
    return this.request('GET', '/admin/api/tokens')
  }

  // ---- Sliding Sync (MSC3575) ----

  async slidingSync(body: Record<string, unknown>, params: { timeout?: number, pos?: string } = {}) {
    const qs = new URLSearchParams()
    if (params.timeout !== undefined)
      qs.set('timeout', String(params.timeout))
    if (params.pos)
      qs.set('pos', params.pos)
    const q = qs.toString()
    return this.request('POST', `/_matrix/client/unstable/org.matrix.simplified_msc3575/sync${q ? `?${q}` : ''}`, body)
  }
}
