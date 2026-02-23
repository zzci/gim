/**
 * 06-admin: Admin API tests. Alice must be admin.
 */

import { alice, bob } from './config'

async function main() {
  const a = await alice()
  const b = await bob()

  console.log('--- 06-admin ---')
  let pass = true

  // 1. Stats
  console.log('\n1. GET /admin/api/stats')
  const stats = await a.adminStats()
  console.log(`   users: ${stats.users}, rooms: ${stats.rooms}, events: ${stats.events}, media: ${stats.media}`)
  if (typeof stats.users !== 'number') {
    console.log('   FAIL: stats.users is not a number')
    pass = false
  }

  // 2. User search
  console.log('\n2. GET /admin/api/users?search=alice')
  const userSearch = await a.adminUsers({ search: 'alice' })
  console.log(`   found: ${userSearch.total} user(s)`)
  if (userSearch.total < 1) {
    console.log('   FAIL: expected at least 1 user matching "alice"')
    pass = false
  }

  // 3. User detail
  console.log(`\n3. GET /admin/api/users/${a.userId}`)
  const userDetail = await a.adminUser(a.userId)
  console.log(`   user: ${userDetail.user?.id}`)
  console.log(`   admin: ${userDetail.user?.admin}`)
  console.log(`   devices: ${userDetail.devices?.length}`)
  if (userDetail.user?.id !== a.userId) {
    console.log('   FAIL: user ID mismatch')
    pass = false
  }

  // 4. Rooms
  console.log('\n4. GET /admin/api/rooms')
  const roomList = await a.adminRooms()
  console.log(`   total rooms: ${roomList.total}`)

  // 5. Tokens
  console.log('\n5. GET /admin/api/tokens')
  const tokenList = await a.adminTokens()
  console.log(`   oauth_tokens: ${tokenList.oauth_tokens?.length}`)
  console.log(`   user_tokens: ${tokenList.user_tokens?.length}`)

  // 6. Non-admin should be forbidden
  console.log('\n6. Non-admin access (Bob)...')
  try {
    await b.adminStats()
    console.log('   FAIL: Bob should not have admin access')
    pass = false
  }
  catch (err: any) {
    if (err.status === 403) {
      console.log('   correctly forbidden (403)')
    }
    else {
      console.log(`   unexpected error: ${err.status} ${err.message}`)
      pass = false
    }
  }

  console.log(`\n   RESULT: ${pass ? 'PASS' : 'FAIL'}`)
}

main().catch((err) => {
  console.error('FAIL:', err.message)
  process.exit(1)
})
