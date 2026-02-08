import { keysQueryRoute } from './keysQuery'
import { keysUploadRoute } from './keysUpload'
import { keysClaimRoute } from './keysClaim'
import { keysChangesRoute } from './keysChanges'
import { crossSigningRoute, signaturesUploadRoute } from './crossSigning'
import { roomKeysVersionRoute } from './roomKeysVersion'
import { sendToDeviceRoute } from './sendToDevice'

export const e2ee = {
  keysQueryRoute,
  keysUploadRoute,
  keysClaimRoute,
  keysChangesRoute,
  crossSigningRoute,
  signaturesUploadRoute,
  roomKeysVersionRoute,
  sendToDeviceRoute,
}
