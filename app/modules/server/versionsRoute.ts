import { Hono } from 'hono'

export const versionsRoute = new Hono()

versionsRoute.get('/', (c) => {
  return c.json({
    versions: [
      'v1.1',
      'v1.2',
      'v1.3',
      'v1.4',
      'v1.5',
      'v1.6',
      'v1.7',
      'v1.8',
      'v1.9',
      'v1.10',
      'v1.11',
      'v1.12',
      'v1.13',
    ],
    unstable_features: {
      'org.matrix.msc2965': true,
      'org.matrix.msc3861': true,
      'org.matrix.msc3814': true,
      'org.matrix.simplified_msc3575': true,
    },
  })
})
