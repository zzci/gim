import { Buffer } from 'node:buffer'
import { createPublicKey, verify } from 'node:crypto'

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object')
    return JSON.stringify(obj)

  if (Array.isArray(obj))
    return `[${obj.map(canonicalJson).join(',')}]`

  const sorted = Object.keys(obj as Record<string, unknown>).sort()
  const entries = sorted.map(k => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`)
  return `{${entries.join(',')}}`
}

function base64UrlToBuffer(b64: string): Buffer {
  // Matrix uses unpadded base64
  let padded = b64.replace(/-/g, '+').replace(/_/g, '/')
  const mod = padded.length % 4
  if (mod === 2)
    padded += '=='
  else if (mod === 3)
    padded += '='
  return Buffer.from(padded, 'base64')
}

export function verifyDeviceKeySignature(
  deviceKeys: Record<string, any>,
  userId: string,
  deviceId: string,
): { valid: true } | { valid: false, reason: string } {
  const ed25519KeyId = `ed25519:${deviceId}`
  const keys = deviceKeys.keys as Record<string, string> | undefined
  if (!keys || !keys[ed25519KeyId])
    return { valid: false, reason: `Missing ${ed25519KeyId} in device keys` }

  const signatures = deviceKeys.signatures as Record<string, Record<string, string>> | undefined
  const userSigs = signatures?.[userId]
  if (!userSigs || !userSigs[ed25519KeyId])
    return { valid: false, reason: `Missing self-signature for ${ed25519KeyId}` }

  const signature = userSigs[ed25519KeyId]
  const publicKeyBase64 = keys[ed25519KeyId]

  // Build the object to verify (without signatures and unsigned)
  const toVerify: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(deviceKeys)) {
    if (k !== 'signatures' && k !== 'unsigned')
      toVerify[k] = v
  }

  const message = canonicalJson(toVerify)

  try {
    const publicKeyBuffer = base64UrlToBuffer(publicKeyBase64)
    const signatureBuffer = base64UrlToBuffer(signature)

    const key = createPublicKey({
      key: Buffer.concat([
        // Ed25519 DER prefix: 30 2a 30 05 06 03 2b 65 70 03 21 00
        Buffer.from('302a300506032b6570032100', 'hex'),
        publicKeyBuffer,
      ]),
      format: 'der',
      type: 'spki',
    })

    const isValid = verify(null, Buffer.from(message), key, signatureBuffer)
    if (!isValid)
      return { valid: false, reason: 'Ed25519 signature verification failed' }

    return { valid: true }
  }
  catch (err: any) {
    return { valid: false, reason: `Signature verification error: ${err.message}` }
  }
}
