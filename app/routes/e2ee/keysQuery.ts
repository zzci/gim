import { Hono } from 'hono'

const data = {
  device_keys: {
    '@roy:a.g.im': {
      m3IlYj9opp: {
        algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
        device_id: 'm3IlYj9opp',
        keys: {
          'curve25519:m3IlYj9opp': '41M5zq+r7UQTS/hMDd9EZAgdtg1S7PrFHrwLLJ7rZnY',
          'ed25519:m3IlYj9opp': 'U6Jqt0AsxVoGbNLnkZZKPepNoAxPSMH2fR8Y0MgIYx0',
        },
        signatures: {
          '@roy:a.g.im': {
            'ed25519:m3IlYj9opp':
              'yU6IWYc+6EQhUZF3fAKNr9RpST5jfXqaXdVvEDTcnT2xqZsCVoK1ggRkEFb/8Yoqxj4wk8QZJSBetebfYFWSCA',
            'ed25519:loy7Cne20s7sU512RZZOuaih2P3+1cjPQZTHXaN4kHA':
              'iqRN3mHy6ydJMPEeN3TzlxqTGUDnWOjT0t0G0mmcQu7aouGpiPu9hkWNWHkUwZTXMNzINPoT2dwtyTqfBal0Dw',
            'ed25519:ONdQpSgJpkCzjOpW7Npya8m/ZsRMlunBQNylqhiCMRg':
              'PAVOvnDjmtX6EKSkgpbgV/G0rP00BnavtNWf6VlsBY3Hyzu9s+loa49F/NsoiWcqszqxivS+sW1nrsLNadZKBg',
          },
        },
        user_id: '@roy:a.g.im',
        unsigned: {
          device_display_name: 'Element X on iPhone 15 Pro',
        },
      },
    },
  },
  failures: {},
  master_keys: {
    '@roy:a.g.im': {
      keys: {
        'ed25519:ybGDp/fVmJB3FVfODxZky181ZDj4yDV1+LzqXY1a+TI': 'ybGDp/fVmJB3FVfODxZky181ZDj4yDV1+LzqXY1a+TI',
      },
      signatures: {
        '@roy:a.g.im': {
          'ed25519:ZYA4bm1z5l':
            'lWZiQ6NArcd64JIM4bHBL+550deVA7aWaYGFoF1pmGu0aXcPrNEWrYenT4RBR8IntWvxD9aRriLIgwvOr/nqCQ',
          'ed25519:ybGDp/fVmJB3FVfODxZky181ZDj4yDV1+LzqXY1a+TI':
            '8oiSoIRDe16omjzGyiOt9FWKgVmWozdmyHipvvRa3ZqjEBT0zyBPpFn6cAknTfOvkQCyAM76vmcpnVuhUOpWBQ',
        },
      },
      usage: ['master'],
      user_id: '@roy:a.g.im',
    },
  },
  self_signing_keys: {
    '@roy:a.g.im': {
      keys: {
        'ed25519:ONdQpSgJpkCzjOpW7Npya8m/ZsRMlunBQNylqhiCMRg': 'ONdQpSgJpkCzjOpW7Npya8m/ZsRMlunBQNylqhiCMRg',
      },
      signatures: {
        '@roy:a.g.im': {
          'ed25519:ybGDp/fVmJB3FVfODxZky181ZDj4yDV1+LzqXY1a+TI':
            'tNqY6QREaOrN9DY3VVFBamH0RBpdg21JuVNEoW8n3Oml9h0utCVSRXe/Kf9LnzzadfAdG3lg0bZjslEnlRvTBQ',
        },
      },
      usage: ['self_signing'],
      user_id: '@roy:a.g.im',
    },
  },
  user_signing_keys: {
    '@roy:a.g.im': {
      keys: {
        'ed25519:Mu/+z7qFa/xu+LcqY2BeyBZvQPbIerQUcfYQhrGRT6Q': 'Mu/+z7qFa/xu+LcqY2BeyBZvQPbIerQUcfYQhrGRT6Q',
      },
      signatures: {
        '@roy:a.g.im': {
          'ed25519:ybGDp/fVmJB3FVfODxZky181ZDj4yDV1+LzqXY1a+TI':
            'XbbESPYTaCbT1K0V0DUDWpXPz7u5Si6w0T77YpdAmirhJ6m+3FBMjZRrEnHM2xRsF8mA9iiphUNeyR0s8LKIBQ',
        },
      },
      usage: ['user_signing'],
      user_id: '@roy:a.g.im',
    },
  },
}

export const keysQueryRoute = new Hono()

keysQueryRoute.post('/', async (c) => {
  try {
    return c.json(data)
  }
  catch (error) {
    logger.error(error)
    c.json({
      ok: false,
      error,
    })
  }
})
