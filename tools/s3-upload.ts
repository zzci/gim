import { readdir, readFile, stat } from 'node:fs/promises'
import path, { join } from 'node:path'
import { ListObjectsCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const accountid = process.env.S3_ACCOUNT_ID || ''
const bucketName = process.env.S3_BUCKET_NAME || ''
const accessKeyId = process.env.S3_ACCESS_KEY_ID || ''
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || ''

// S3 连接配置验证
if (!accountid || !bucketName || !accessKeyId || !secretAccessKey) {
  console.error('Missing required S3 configuration:')
  console.error(`Account ID: ${accountid ? '✓' : '✗'}`)
  console.error(`Bucket Name: ${bucketName ? '✓' : '✗'}`)
  console.error(`Access Key ID: ${accessKeyId ? '✓' : '✗'}`)
  console.error(`Secret Access Key: ${secretAccessKey ? '✓' : '✗'}`)
  process.exit(1)
}

async function s3uload(localPath: string, keyPrefix: string = '') {
  let S3: S3Client
  try {
    S3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountid}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })
    const input = {
      Bucket: bucketName,
      MaxKeys: 1,
    }
    const command = new ListObjectsCommand(input)
    await S3.send(command)
  }
  catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to initialize S3 client: ${errorMessage}`)
  }

  async function uploadFile(filePath: string, key: string) {
    const fileContent = await readFile(filePath)
    const input = {
      Body: fileContent,
      Bucket: bucketName,
      Key: key,
    }
    try {
      const command = new PutObjectCommand(input)
      const response = await S3.send(command)
      if (response.VersionId) {
        console.warn(`sucess: ${key}, ${response.VersionId}`)
      }
      else {
        throw new Error(`No VersionId returned`)
      }
    }
    catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`failed: ${key} - ${errorMessage}`)
    }
  }

  async function processDirectory(dirPath: string, currentPrefix: string) {
    const items = await readdir(dirPath)

    for (const item of items) {
      const fullPath = join(dirPath, item)
      const itemStat = await stat(fullPath)

      if (itemStat.isDirectory()) {
        await processDirectory(fullPath, `${currentPrefix}${item}/`)
      }
      else {
        const key = `${currentPrefix}${item}`
        await uploadFile(fullPath, key)
      }
    }
  }

  await processDirectory(localPath, keyPrefix)
}

// 从命令行参数获取文件路径和前缀
const args = process.argv.slice(2)
const localPath = args[0] || ''
const keyPrefix = args[1] || ''

if (!localPath || !keyPrefix) {
  console.warn('Usage: bun s3 <localPath> <keyPrefix>')
  console.error('Please provide localPath and keyPrefix.')
  process.exit(0)
}

// 解析相对路径为绝对路径
const resolvedLocalPath = path.isAbsolute(localPath)
  ? localPath
  : path.resolve(process.cwd(), localPath)

// 验证路径是否存在
try {
  stat(resolvedLocalPath)
}
catch {
  console.error(`Error: Path '${resolvedLocalPath}' does not exist.`)
  process.exit(1)
}

const finalLocalPath = resolvedLocalPath

console.warn(`Uploading from: ${finalLocalPath}`)
console.warn(`Using key prefix: ${keyPrefix}`)
console.warn(`Bucket: ${bucketName}`)
console.warn(`Endpoint: https://${accountid}.r2.cloudflarestorage.com`)

// 使用示例
;(async () => {
  try {
    await s3uload(finalLocalPath, keyPrefix)
    console.warn('Upload completed')
  }
  catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(errorMessage)
  }
})()
