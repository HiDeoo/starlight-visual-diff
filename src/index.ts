import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { pathToFileURL } from 'node:url'
import { styleText } from 'node:util'

import { chromium, devices, type Page } from 'playwright'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import terminalLink from 'terminal-link'

import config from '../config.ts'

const baselineBaseUrl = new URL(config.baseUrl.baseline)
const candidateBaseUrl = new URL(config.baseUrl.candidate)

await runVisualDiff()

async function runVisualDiff() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext(devices['Desktop Chrome'])

  try {
    await setupScreenshotsDirectory()
    console.log()

    const failures: VisualDiffFailure[] = []

    for (const routePath of config.paths) {
      const page = await context.newPage()
      const updateStatus = logVisualDiffStatus(routePath)

      try {
        const failure = await compareRoute(page, routePath)

        if (failure) {
          failures.push(failure)
          updateStatus('failure')
        } else {
          updateStatus('success')
        }
      } catch (error) {
        updateStatus('failure')
        throw error
      } finally {
        await page.close()
      }
    }

    if (failures.length > 0) {
      console.error(
        styleText(['red', 'bold'], `\nFound ${failures.length} visual difference${failures.length > 1 ? 's' : ''}:\n`),
      )

      for (const failure of failures) {
        console.error(`${formatVisualDiffFailure(failure)}\n`)
      }

      process.exitCode = 1
    } else {
      console.log(styleText(['green', 'bold'], '\nNo visual differences found.'))
    }
  } finally {
    await context.close()
    await browser.close()
  }
}

async function setupScreenshotsDirectory() {
  await setupScreenshotBaselineDirectory()

  // Delete the candidate and diff screenshots directories before running.
  await fs.rm(getScreenshotDirectoryPath('candidate'), { force: true, recursive: true })
  await fs.rm(getScreenshotDirectoryPath('diff'), { force: true, recursive: true })

  // Ensure the diff screenshots directory exists.
  await fs.mkdir(getScreenshotDirectoryPath('diff'), { recursive: true })
}

async function setupScreenshotBaselineDirectory() {
  const baselineMetadataPath = path.join(getScreenshotDirectoryPath('baseline'), 'metadata.json')
  let baselineMetadata: BaselineMetadata | undefined

  try {
    const data = await fs.readFile(baselineMetadataPath, 'utf8')
    baselineMetadata = JSON.parse(data)
  } catch {
    // No baseline metadata found
  }

  // If the baseline base URL has changed since the last run, delete the existing baseline screenshots directory.
  if (baselineMetadata?.baseUrl !== baselineBaseUrl.href) {
    await fs.rm(getScreenshotDirectoryPath('baseline'), { force: true, recursive: true })
  }

  await fs.mkdir(getScreenshotDirectoryPath('baseline'), { recursive: true })
  await fs.writeFile(baselineMetadataPath, `${JSON.stringify({ baseUrl: baselineBaseUrl.href }, null, 2)}\n`)
}

async function compareRoute(page: Page, routePath: string) {
  const baselineScreenshotPath = getScreenshotPath(routePath, 'baseline')

  // Take a screenshot of the baseline route if it doesn't exist.
  if (!(await exists(baselineScreenshotPath))) {
    await page.goto(new URL(routePath, baselineBaseUrl).toString())
    await takeScreenshot(page, baselineScreenshotPath)
  }

  const candidateScreenshotPath = getScreenshotPath(routePath, 'candidate')

  // Take a screenshot of the candidate route.
  await page.goto(new URL(routePath, candidateBaseUrl).toString())
  await takeScreenshot(page, candidateScreenshotPath)

  // Compare the screenshots between the baseline and candidate routes.
  const { diffPixels, diffImage } = await compareScreenshots(baselineScreenshotPath, candidateScreenshotPath)

  // Save the diff image if the number of mismatched pixels is greater than the maximum allowed.
  if (diffPixels > config.maxDiffPixels) {
    const diffScreenshotPath = getScreenshotPath(routePath, 'diff')
    await fs.writeFile(diffScreenshotPath, PNG.sync.write(diffImage))

    return { routePath, diffPixels, diffScreenshotPath }
  }

  return
}

async function compareScreenshots(screenshotPath1: string, screenshotPath2: string) {
  let screenshot1: PNG = await getScreenshot(screenshotPath1)
  let screenshot2: PNG = await getScreenshot(screenshotPath2)

  let diffSize: ScreenshotSize

  // If the screenshots have different dimensions, resize them to the largest dimensions so we can
  // see where the differences start to appear.
  if (screenshot1.width !== screenshot2.width || screenshot1.height !== screenshot2.height) {
    diffSize = {
      width: Math.max(screenshot1.width, screenshot2.width),
      height: Math.max(screenshot1.height, screenshot2.height),
    }

    screenshot1 = resizeScreenshot(screenshot1, diffSize)
    screenshot2 = resizeScreenshot(screenshot2, diffSize)
  } else {
    diffSize = { width: screenshot1.width, height: screenshot1.height }
  }

  const diffImage = new PNG(diffSize)

  const diffPixels = pixelmatch(screenshot1.data, screenshot2.data, diffImage.data, diffSize.width, diffSize.height, {
    threshold: 0.2,
  })

  return { diffPixels, diffImage }
}

function resizeScreenshot(screenshot: PNG, size: ScreenshotSize) {
  const resized = new PNG(size)
  PNG.bitblt(screenshot, resized, 0, 0, screenshot.width, screenshot.height)
  return resized
}

async function getScreenshot(screenshotPath: string) {
  const data = await fs.readFile(screenshotPath)
  return PNG.sync.read(data)
}

async function takeScreenshot(page: Page, screenshotPath: string) {
  // Ensure all images are loaded before taking the screenshot.
  for (const lazyImage of await page.locator('img[loading="lazy"]:visible').all()) {
    await lazyImage.scrollIntoViewIfNeeded()
  }

  const overviewLink = page.getByRole('link', { name: 'Overview', exact: true })

  // Scroll to the top of the page to ensure the screenshot is consistent.
  if (await overviewLink.isVisible()) {
    // Use the Overview link when possible to avoid mismatched pixels due to ToC highlighting.
    await overviewLink.click()
  } else {
    await page.evaluate(() => window.scrollTo(0, 0))
  }

  await page.waitForTimeout(500)

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
    style: 'astro-dev-toolbar { display: none; }',
  })
}

function getScreenshotDirectoryPath(type: ScreenshotType) {
  return path.join('screenshots', type)
}

function getScreenshotPath(routePath: string, type: ScreenshotType) {
  const slug = routePath.replace(/\//g, '-').replace(/^-/, '').replace(/-$/, '').replace(/^$/, 'index')
  const hash = crypto.createHash('sha256').update(routePath).digest('hex').slice(0, 8)

  return path.join(getScreenshotDirectoryPath(type), `${slug}-${hash}.png`)
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

function logVisualDiffStatus(routePath: string) {
  const message = `${styleText('underline', 'Visual diff:')} ${routePath}`

  process.stdout.write(`- ${message}`)

  return (status: VisualDiffStatus) => {
    readline.clearLine(process.stdout, 0)
    readline.cursorTo(process.stdout, 0)

    const symbol = status === 'success' ? styleText('green', '✓') : styleText('red', '✗')

    process.stdout.write(`${symbol} ${message}\n`)
  }
}

function formatVisualDiffFailure(failure: VisualDiffFailure) {
  const diffScreenshotUrl = pathToFileURL(path.resolve(failure.diffScreenshotPath)).href
  const diffScreenshotLink = terminalLink.stderr(failure.diffScreenshotPath, diffScreenshotUrl, { fallback: false })

  return [`Route: ${failure.routePath}`, `Diff image: ${styleText('underline', diffScreenshotLink)}`].join('\n')
}

type ScreenshotType = 'baseline' | 'candidate' | 'diff'

interface ScreenshotSize {
  width: number
  height: number
}

interface BaselineMetadata {
  baseUrl: string
}

interface VisualDiffFailure {
  routePath: string
  diffPixels: number
  diffScreenshotPath: string
}

type VisualDiffStatus = 'success' | 'failure'
