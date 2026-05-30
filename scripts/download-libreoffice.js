/**
 * 下载 LibreOffice Portable 并解压到 resources/libreoffice/
 * 用法: node scripts/download-libreoffice.js
 */
const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const TARGET_DIR = path.join(__dirname, '..', 'resources', 'libreoffice')
const TEMP_FILE = path.join(process.env.TEMP || '/tmp', 'LibreOfficePortable.paf.exe')

// 多个镜像源，逐个尝试（优先国内镜像）
const MIRRORS = [
  // 清华大学 TUNA 镜像 (最新 26.2.1)
  'https://mirrors.tuna.tsinghua.edu.cn/libreoffice/libreoffice/portable/26.2.1/LibreOfficePortable_26.2.1_MultilingualStandard.paf.exe',
  // 中科大 USTC 镜像
  'https://mirrors.ustc.edu.cn/tdf/libreoffice/portable/26.2.1/LibreOfficePortable_26.2.1_MultilingualStandard.paf.exe',
  // SourceForge 国际镜像 (备选)
  'https://newcontinuum.dl.sourceforge.net/project/portableapps/LibreOffice%20Portable/LibreOfficePortableLegacyWin7_25.2.7_MultilingualStandard.paf.exe',
  'https://netix.dl.sourceforge.net/project/portableapps/LibreOffice%20Portable/LibreOfficePortableLegacyWin7_25.2.7_MultilingualStandard.paf.exe',
  'https://phoenixnap.dl.sourceforge.net/project/portableapps/LibreOffice%20Portable/LibreOfficePortableLegacyWin7_25.2.7_MultilingualStandard.paf.exe',
]

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const protocol = url.startsWith('https') ? https : http

    console.log(`  连接: ${url}`)
    const req = protocol.get(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://mirrors.tuna.tsinghua.edu.cn/'
      },
      timeout: 30000
    }, (res) => {
      // 跟随重定向
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
  // .paf.exe 是 7z 自解压文件，用 7z/7za 解压
  console.log('  解压中...')

  // 查找 7z 或 7za
  const sevenZipPaths = [
    // 脚本自带的 7za.exe（独立版）
    path.join(__dirname, '7za.exe'),
    // 系统安装的 7-Zip
    'C:\\Program Files\\7-Zip\\7z.exe',
    'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    path.join(process.env['ProgramFiles'] || '', '7-Zip', '7z.exe'),
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
    // 没有 7z，尝试直接运行 paf.exe 自解压（/D 指定目录，/SILENT 静默）
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

async function main() {
  console.log('=== 下载 LibreOffice Portable ===\n')

  // 检查是否已存在
  const sofficeExe = path.join(TARGET_DIR, 'LibreOfficePortable', 'App', 'libreoffice', 'program', 'soffice.exe')
  if (fs.existsSync(sofficeExe)) {
    console.log(`  LibreOffice 已存在于: ${sofficeExe}`)
    console.log('  跳过下载。如需重新下载，请先删除 resources/libreoffice/ 目录。')
    return
  }

  // 清理旧临时文件
  if (fs.existsSync(TEMP_FILE)) fs.unlinkSync(TEMP_FILE)

  // 逐个尝试镜像
  let success = false
  for (const mirror of MIRRORS) {
    console.log(`尝试镜像: ${mirror.split('/')[2]}`)
    try {
      await downloadFile(mirror, TEMP_FILE)
      const size = fs.statSync(TEMP_FILE).size
      if (size < 10 * 1024 * 1024) {
        console.log(`  文件太小 (${(size/1024/1024).toFixed(1)}MB)，可能不是有效的安装包，尝试下一个镜像...`)
        fs.unlinkSync(TEMP_FILE)
        continue
      }
      success = true
      break
    } catch (err) {
      console.log(`  失败: ${err.message}`)
      if (fs.existsSync(TEMP_FILE)) fs.unlinkSync(TEMP_FILE)
    }
  }

  if (!success) {
    console.error('\n所有镜像下载失败。请手动下载 LibreOffice Portable 并解压到:')
    console.error(`  ${TARGET_DIR}`)
    console.error('下载地址: https://portableapps.com/apps/office/libreoffice_portable')
    process.exit(1)
  }

  console.log('\n  下载完成！')

  // 解压
  console.log('开始解压...')
  try {
    await extractPaf(TEMP_FILE, TARGET_DIR)
    console.log('  解压完成！')
  } catch (e) {
    console.error(`解压失败: ${e.message}`)
    console.error(`请手动解压 ${TEMP_FILE} 到 ${TARGET_DIR}`)
    process.exit(1)
  }

  // 清理临时文件
  if (fs.existsSync(TEMP_FILE)) fs.unlinkSync(TEMP_FILE)

  // 验证
  if (fs.existsSync(sofficeExe)) {
    console.log(`\n✓ LibreOffice 就绪: ${sofficeExe}`)
  } else {
    console.error(`\n✗ 未找到 soffice.exe，解压可能不完整。`)
    console.error(`  期望路径: ${sofficeExe}`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('错误:', err.message)
  process.exit(1)
})
