import { metadataRoute } from './metadata'
import { oauth2RegistrationRoute } from './oauth2_registration'
import { loginRoute } from './login'
import { registerRoute } from './register'
import { logoutRoute } from './logout'
import { refreshRoute } from './refresh'

export const auth = {
  metadataRoute,
  oauth2RegistrationRoute,
  loginRoute,
  registerRoute,
  logoutRoute,
  refreshRoute,
}
