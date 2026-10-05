import { expect, test } from '@playwright/test'

test.describe('Status dashboard', () => {
  test('renders the compact grouped status layout without dropping status payload groups', async ({ page }) => {
    await page.route('**/api/status', async (route) => {
      await route.fulfill({
        json: {
          status: 'ok',
          generatedAt: '2026-04-23T20:13:17Z',
          uptimeSeconds: 7384,
          summary: {
            status: 'ok', visits: 125, sessions: 99,
            compiler: { version: '1.37.1.8677', commandsSinceStart: 15, commandsHistorical: 4500 },
          },
          build: {
            sourceCommit: 'e3cdcad2cf7de3b9e510efc58856086406004718',
            sourceRefName: 'master',
          },
          release: {
            releaseTag: 'v0.0.8',
            sourceCommit: 'e3cdcad2cf7de3b9e510efc58856086406004718',
          },
          process: {
            pid: 42,
          },
          config: {
            executionUrl: 'http://code-exec:3000',
          },
          dependencies: [
            { name: 'txlBinary', status: 'ok', path: '/usr/local/bin/txl' },
            { name: 'modelStore', status: 'ok', path: '/app/data/models' },
          ],
          checks: {
            umplesyncJar: { status: 'ok' },
            executionService: { status: 'ok' },
          },
          umplesync: {
            status: 'ok',
            alive: true,
            port: 3002,
            log: 'Umple compiler listener ready',
          },
          services: {
            codeExecution: { status: 'ok', url: 'http://code-exec:3000/status' },
            collaboration: {
              status: 'ok', url: 'http://collab:3003/status',
              numberOfActiveUsers: 3, numberOfActiveSessions: 2,
              sessionsInitiatedSinceStart: 12, sessionsCollaboratedSinceStart: 4,
              maxConcurrentCollaborators: 3,
            },
            lsp: { status: 'ok', url: 'http://lsp:3004/status' },
          },
          counters: {
            sessionsStarted: 3,
          },
          legacy: {
            software: [{ name: 'java', status: 'ok', path: '/usr/bin/java' }],
            listener: { status: 'ok', port: 3002 },
            docker: {
              status: 'ok',
              containers: [{ name: 'umpleonline-backend', id: 'abc123', ports: '3001/tcp' }],
              stats: [{ Name: 'umpleonline-backend', CPUPerc: '0.2%', MemUsage: '32MiB / 2GiB' }],
            },
            execution: { status: 'ok' },
            visits: { status: 'not_tracked' },
          },
        },
      })
    })

    await page.goto('/status')

    await expect(page.getByRole('heading', { name: 'UmpleOnline Status' })).toBeVisible()
    await expect(page.getByTestId('status-dashboard')).toBeVisible()
    await expect(page.getByText('Backend uptime')).toBeVisible()
    await expect(page.getByText('Service health', { exact: true })).toBeVisible()
    await expect(page.getByTestId('status-service-health')).toContainText('Code Execution')
    await expect(page.getByTestId('status-service-health')).toContainText('txlBinary')
    await expect(page.getByTestId('status-release-runtime')).toContainText('e3cdcad2cf7de3b9e510efc58856086406004718')
    await expect(page.getByTestId('status-release-runtime')).toContainText('http://code-exec:3000')
    await expect(page.getByTestId('status-umplesync')).toContainText('Umple compiler listener ready')
    await expect(page.getByTestId('status-diagnostics')).toContainText('Runtime tools')
    await expect(page.getByTestId('status-diagnostics')).toContainText('Runs umplesync.jar')
    await expect(page.getByTestId('status-diagnostics')).toContainText('umpleonline-backend')
    await expect(page.getByTestId('status-usage')).toContainText('4500')
    await expect(page.getByTestId('status-usage')).toContainText('1.37.1.8677')
    await expect(page.getByTestId('status-collaboration')).toContainText('Sessions Collaborated Since Start')
    await expect(page.getByTestId('status-lsp')).toContainText('http://lsp:3004/status')
    await expect(page.getByTestId('status-execution')).toContainText('http://code-exec:3000/status')
    await expect(page.getByTestId('status-diagnostics')).toContainText('32MiB / 2GiB')
    await page.screenshot({ path: 'test-results/status-dashboard.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    const mobileWidth = await page.locator('main').evaluate((element) => element.scrollWidth)
    expect(mobileWidth).toBeLessThanOrEqual(390)
    await expect(page.locator('.react-resizable-handle')).toHaveCount(0)
    await expect(page.locator('.status-widget-drag-handle')).toHaveCount(0)
  })
})

test('status failure can be retried', async ({ page }) => {
  let fail = true
  await page.route('**/api/status', route => route.fulfill(
    fail ? { status: 503, json: { error: 'Monitoring temporarily unavailable' } } :
      { json: { status: 'degraded', generatedAt: '2026-10-04T12:00:00Z', uptimeSeconds: 10 } },
  ))
  await page.goto('/status')
  await expect(page.getByRole('alert')).toContainText('Monitoring temporarily unavailable')
  fail = false
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByTestId('status-dashboard')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('editor footer shows statistics and links to the dashboard without counting reloads as new sessions', async ({ page }) => {
  let visits = 0
  let sessions = 0
  let fullStatusRequests = 0
  await page.addInitScript(() => {
    localStorage.setItem('umple-preferences-v1', JSON.stringify({
      state: { hasSeenWelcome: true, dynamicGeneration: false }, version: 4,
    }))
  })
  await page.route('**/api/examples', route => route.fulfill({ json: [] }))
  await page.route('**/api/status/visit', route => { visits++; return route.fulfill({ status: 204 }) })
  await page.route('**/api/status/session', route => { sessions++; return route.fulfill({ status: 204 }) })
  await page.route('**/api/status', route => { fullStatusRequests++; return route.fulfill({ status: 503 }) })
  await page.route('**/api/status/summary', route => route.fulfill({ json: {
    status: 'ok', visits: 125, sessions: 99, branch: 'master', commit: 'abcdef123456789',
    updatedAt: new Date(Date.now() - 2 * 86400_000).toISOString(),
    compiler: { version: '1.37.1.8677', commandsHistorical: 4500 },
  } }))
  await page.goto('/')
  const footer = page.getByTestId('status-footer')
  await expect(footer).toContainText('125 visits')
  await expect(footer).toContainText('99 sessions')
  await expect(footer).toContainText('4,500 commands run')
  await expect(footer).toContainText('Compiler 1.37.1.8677')
  await expect(footer).toContainText('Branch master')
  await expect(footer).toContainText('Updated 2d ago')
  await expect.poll(() => visits).toBe(1)
  await expect.poll(() => sessions).toBe(1)
  expect(fullStatusRequests).toBe(0)
  await page.reload()
  await expect(footer).toBeVisible()
  await expect.poll(() => visits).toBe(2)
  expect(sessions).toBe(1)
  await expect(footer.getByRole('link', { name: 'Server status' })).toHaveAttribute('href', '/status')
})

test('editor keeps working when statistics are unavailable', async ({ page }) => {
  await page.route('**/api/examples', route => route.fulfill({ json: [] }))
  await page.route('**/api/status/**', route => route.fulfill({ status: 503, json: { error: 'offline' } }))
  await page.goto('/')
  await expect(page.getByTestId('status-footer')).toContainText('Server statistics unavailable')
  await expect(page.getByTestId('app-shell')).toBeVisible()
})
