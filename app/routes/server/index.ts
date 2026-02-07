import { apiRoute } from './api'
import { capabilitiesRoute } from './capabilities'
import { versionsRoute } from './versions'
import { homeRoute } from './home'
import { wellKnowClientRoute, wellKnowServerRoute } from './well-know'

export const server = {
  apiRoute,
  capabilitiesRoute,
  versionsRoute,
  homeRoute,
  wellKnowClientRoute,
  wellKnowServerRoute,
}
