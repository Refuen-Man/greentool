/**
 * 下载 LibreOffice 到 resources/libreoffice/
 *   Windows: LibreOffice Portable (.paf.exe → 7z 解压)
 *   macOS:   LibreOffice DMG → hdiutil 挂载 → 复制 .app
 * 用法: node scripts/download-libreoffice.js
 */
const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const os = require('os')

const TARGET_DIR = path.join(__dirname, '..', 'resources', 'libreoffice')
const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'

// ========== Windows 镜像（国内优先 + 官方备选） ==========
const WIN_MIRRORS = [
  'https://mirrors.tuna.tsinghua.edu.cn/libreoffice/libreoffice/portable/26.2.1/LibreOfficePortable_26.2.1_MultilingualStandard.paf.exe',
  'https://mirrors.ustc.edu.cn/tdf/libreoffice/portable/26.2.1/LibreOfficePortable_26.2.1_MultilingualStandard.paf.exe',
  // 官方 PortableApps 源（对于国外 CI runner 更可靠）
  'https://newcontinuum.dl.sourceforge.net/project/portableapps/LibreOffice%20Portable/LibreOfficePortable_26.2.1_MultilingualStandard.paf.exe',
  'https://netix.dl.sourceforge.net/project/portableapps/LibreOffice%20Portable/LibreOfficePortable_26.2.1_MultilingualStandard.paf.exe',
]

// ========== macOS 镜像（国内优先 + 官方备选） ==========
const MAC_MIRRORS = [
  'https://mirrors.tuna.tsinghua.edu.cn/libreoffice/libreoffice/stable/26.2.1/mac/aarch64/LibreOffice_26.2.1_MacOS_aarch64.dmg',
  'https://mirrors.ustc.edu.cn/tdf/libreoffice/stable/26.2.1/mac/aarch64/LibreOffice_26.2.1_MacOS_aarch64.dmg',
  // 官方 TDF 镜像（对于国外 CI runner 更可靠）
  'https://download.documentfoundation.org/libreoffice/stable/26.2.1/mac/aarch64/LibreOffice_26.2.1_MacOS_aarch64.dmg',
  'https://downloadarchive.documentfoundation.org/libreoffice/old/26.2.1/mac/aarch64/LibreOffice_26.2.1_MacOS_aarch64.dmg',
]

// ========== 验证目标文件 ==========
const SOFFICE_WIN = path.join(TARGET_DIR, 'App', 'libreoffice', 'program', 'soffice.exe')
const SOFFICE_MAC = path.join(TARGET_DIR, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice')

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const protocol = url.startsWith('https') ? https : http

    console.log(`  连接: ${url}`)
    const req = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      timeout: 30000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close()
        fs.unlinkSync(dest)
        console.log(`  重定向到: ${res.headers.location}`)
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject)
      }

      if (res.statusCode !== 200) {
        file.close()
        fs.unlinkSync(dest)
        return reject(new Error(`HTTP ${res.statusCode}`))
      }

      const total = parseInt(res.headers['content-length'], 10) || 0
      let downloaded = 0
      let lastLog = 0

      res.on('data', (chunk) => {
        downloaded += chunk.length
        file.write(chunk)
        if (total > 0 && Date.now() - lastLog > 2000) {
          lastLog = Date.now()
          const pct = ((downloaded / total) * 100).toFixed(1)
          const mb = (downloaded / 1024 / 1024).toFixed(1)
          const totalMb = (total / 1024 / 1024).toFixed(1)
          process.stdout.write(`\r  进度: ${pct}% (${mb}/${totalMb} MB)`)
        }
      })

      res.on('end', () => {
        file.end()
        if (total > 0) process.stdout.write('\r  进度: 100.0%\n')
        resolve()
      })

      res.on('error', (err) => {
        file.close()
        fs.unlinkSync(dest)
        reject(err)
      })
    })

    req.on('error', (err) => {
      file.close()
      if (fs.existsSync(dest)) fs.unlinkSync(dest)
      reject(err)
    })
  })
}

async function extractPaf(pafPath, destDir) {
  console.log('  解压中...')

  const sevenZipPaths = [
    // GitHub Actions Windows runner 自带的 7z
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    path.join(process.env['ProgramFiles'] || '', '7-Zip', '7z.exe'),
    path.join(process.env['ProgramW6432'] || '', '7-Zip', '7z.exe'),
    // 本地开发：脚本同目录的 7za.exe
    path.join(__dirname, '7za.exe'),
  ]

  let sevenZip = null
  for (const p of sevenZipPaths) {
    if (fs.existsSync(p)) { sevenZip = p; break }
  }

  if (sevenZip) {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    execSync(`"${sevenZip}" x "${pafPath}" -o"${destDir}" -y`, {
      stdio: 'inherit',
      timeout: 300000
    })
  } else {
    console.log('  未找到 7-Zip，尝试自解压...')
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    try {
      execSync(`"${pafPath}" /D="${destDir}" /SILENT`, {
        stdio: 'inherit',
        timeout: 300000
      })
    } catch (e) {
      throw new Error('解压失败。请安装 7-Zip 后重试，或将 .paf.exe 手动解压到 resources/libreoffice/')
    }
  }
}

async function extractDmg(dmgPath, destDir) {
  console.log('  挂载 DMG...')
  // 挂载 DMG
  const mountResult = execSync(`hdiutil attach "${dmgPath}" -nobrowse -readonly`, {
    encoding: 'utf8',
    timeout: 60000
  })
  // 解析挂载点（通常是 /Volumes/LibreOffice）
  const lines = mountResult.trim().split('\n')
  const lastLine = lines[lines.length - 1] || ''
  const parts = lastLine.split('\t')
  const mountPoint = parts[parts.length - 1]?.trim()
  if (!mountPoint || !fs.existsSync(mountPoint)) {
    throw new Error('无法确定 DMG 挂载点: ' + mountResult)
  }
  console.log(`  挂载点: ${mountPoint}`)

  // 查找 .app 并复制
  const entries = fs.readdirSync(mountPoint).filter(f => f.endsWith('.app'))
  if (entries.length === 0) throw new Error('DMG 中未找到 .app')
  const appName = entries[0]
  const srcApp = path.join(mountPoint, appName)

  // 如果目标已存在，先删除
  const destApp = path.join(destDir, 'LibreOffice.app')
  if (fs.existsSync(destApp)) {
    fs.rmSync(destApp, { recursive: true, force: true })
  }
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })

  console.log(`  复制 ${appName} → ${destApp}（可能需要几分钟）...`)
  execSync(`cp -R "${srcApp}" "${destApp}"`, {
    stdio: 'inherit',
    timeout: 600000
  })

  // 卸载 DMG
  console.log('  卸载 DMG...')
  try { execSync(`hdiutil detach "${mountPoint}" -force`, { stdio: 'ignore' }) } catch {}
}

async function downloadAndExtract(mirrors, extractFn, tempPath) {
  let success = false
  for (const mirror of mirrors) {
    console.log(`尝试镜像: ${new URL(mirror).hostname}`)
    try {
      await downloadFile(mirror, tempPath)
      const size = fs.statSync(tempPath).size
      if (size < 10 * 1024 * 1024) {
        console.log(`  文件太小 (${(size/1024/1024).toFixed(1)}MB)，可能无效，尝试下一个镜像...`)
        fs.unlinkSync(tempPath)
        continue
      }
      success = true
      break
    } catch (err) {
      console.log(`  失败: ${err.message}`)
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
    }
  }
  if (!success) throw new Error('所有镜像下载失败')

  console.log('\n  下载完成！开始解压...')
  await extractFn()
  console.log('  解压完成！')
}

async function main() {
  console.log(`=== 下载 LibreOffice (${process.platform}) ===\n`)

  // 检查已存在
  const verifyPath = IS_MAC ? SOFFICE_MAC : SOFFICE_WIN
  if (fs.existsSync(verifyPath)) {
    console.log(`  LibreOffice 已存在于: ${verifyPath}`)
    console.log('  跳过下载。如需重新下载，请先删除 resources/libreoffice/ 目录。')
    return
  }

  if (IS_WIN) {
    const tempFile = path.join(process.env.TEMP || os.tmpdir(), 'LibreOfficePortable.paf.exe')
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
    await downloadAndExtract(WIN_MIRRORS, () => extractPaf(tempFile, TARGET_DIR), tempFile)
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
    if (!fs.existsSync(SOFFICE_WIN)) {
      console.error(`\n✗ 未找到 soffice.exe，解压可能不完整。期望: ${SOFFICE_WIN}`)
      process.exit(1)
    }
  } else if (IS_MAC) {
    const tempFile = path.join(os.tmpdir(), 'LibreOffice.dmg')
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
    await downloadAndExtract(MAC_MIRRORS, () => extractDmg(tempFile, TARGET_DIR), tempFile)
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
    if (!fs.existsSync(SOFFICE_MAC)) {
      console.error(`\n✗ 未找到 soffice，解压可能不完整。期望: ${SOFFICE_MAC}`)
      process.exit(1)
    }
  } else {
    console.error('当前平台不支持自动下载 LibreOffice，请手动安装。')
    process.exit(1)
  }

  console.log(`\n✓ LibreOffice 就绪: ${verifyPath}`)
}

main().catch(err => {
  console.error('错误:', err.message)
  process.exit(1)
})
