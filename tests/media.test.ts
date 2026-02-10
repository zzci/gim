import { describe, expect, test } from 'bun:test'
import { getAlice } from './helpers'

const BASE_URL = process.env.GIM_URL || 'http://localhost:3000'
const SERVER_NAME = process.env.IM_SERVER_NAME || 'localhost'

describe('Media', () => {
  test('upload and download a text file', async () => {
    const a = await getAlice()
    const content = 'Hello, this is a test file!'
    const res = await fetch(`${BASE_URL}/_matrix/client/v1/media/upload?filename=test.txt`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${a.accessToken}`,
        'Content-Type': 'text/plain',
      },
      body: content,
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.content_uri).toMatch(/^mxc:\/\//)

    // Extract serverName and mediaId from mxc URI
    const [, , server, mediaId] = json.content_uri.split('/')
    expect(server).toBe(SERVER_NAME)

    // Download
    const dl = await fetch(`${BASE_URL}/_matrix/client/v1/media/download/${server}/${mediaId}`, {
      headers: { Authorization: `Bearer ${a.accessToken}` },
    })
    expect(dl.status).toBe(200)
    const downloaded = await dl.text()
    expect(downloaded).toBe(content)
  })

  test('media config returns upload size limit', async () => {
    const a = await getAlice()
    const res = await fetch(`${BASE_URL}/_matrix/client/v1/media/config`, {
      headers: { Authorization: `Bearer ${a.accessToken}` },
    })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json['m.upload.size']).toBe(52428800)
  })

  test('download non-existent media returns 404', async () => {
    const a = await getAlice()
    const res = await fetch(`${BASE_URL}/_matrix/client/v1/media/download/${SERVER_NAME}/nonexistent-media-id`, {
      headers: { Authorization: `Bearer ${a.accessToken}` },
    })
    expect(res.status).toBe(404)
    const json = await res.json() as any
    expect(json.errcode).toBe('M_NOT_FOUND')
  })

  test('download from wrong server name returns 404', async () => {
    const a = await getAlice()
    const res = await fetch(`${BASE_URL}/_matrix/client/v1/media/download/wrong.server.name/some-media-id`, {
      headers: { Authorization: `Bearer ${a.accessToken}` },
    })
    expect(res.status).toBe(404)
    const json = await res.json() as any
    expect(json.errcode).toBe('M_NOT_FOUND')
  })

  test('async upload: create then PUT content then download', async () => {
    const a = await getAlice()

    // Step 1: Create mxc URI
    const createRes = await fetch(`${BASE_URL}/_matrix/client/v1/media/create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${a.accessToken}` },
    })
    expect(createRes.status).toBe(200)
    const createJson = await createRes.json() as any
    expect(createJson.content_uri).toMatch(/^mxc:\/\//)
    expect(createJson.unused_expires_at).toBeGreaterThan(Date.now())

    // Extract serverName and mediaId
    const [, , server, mediaId] = createJson.content_uri.split('/')

    // Step 2: PUT content
    const content = 'async upload content'
    const putRes = await fetch(`${BASE_URL}/_matrix/client/v1/media/upload/${server}/${mediaId}?filename=async.txt`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${a.accessToken}`,
        'Content-Type': 'text/plain',
      },
      body: content,
    })
    expect(putRes.status).toBe(200)

    // Step 3: Download and verify
    const dl = await fetch(`${BASE_URL}/_matrix/client/v1/media/download/${server}/${mediaId}`, {
      headers: { Authorization: `Bearer ${a.accessToken}` },
    })
    expect(dl.status).toBe(200)
    const downloaded = await dl.text()
    expect(downloaded).toBe(content)
  })

  test('filename in Content-Disposition preserved', async () => {
    const a = await getAlice()
    const content = 'file with name'
    const res = await fetch(`${BASE_URL}/_matrix/client/v1/media/upload?filename=myfile.txt`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${a.accessToken}`,
        'Content-Type': 'text/plain',
      },
      body: content,
    })
    const json = await res.json() as any
    const [, , server, mediaId] = json.content_uri.split('/')

    const dl = await fetch(`${BASE_URL}/_matrix/client/v1/media/download/${server}/${mediaId}`, {
      headers: { Authorization: `Bearer ${a.accessToken}` },
    })
    expect(dl.status).toBe(200)
    const disposition = dl.headers.get('content-disposition')
    expect(disposition).toContain('myfile.txt')
  })
})
