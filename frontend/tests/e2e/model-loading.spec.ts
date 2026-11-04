import { expect, test, type Page } from '@playwright/test'
import type { GenerationRequest } from '../../src/api/types'

async function setup(page: Page, staleSession = false) {
  await page.addInitScript((stale) => {
    localStorage.setItem('umple-preferences-v1', JSON.stringify({ state: { hasSeenWelcome: true, dynamicGeneration: true }, version: 4 }))
    if (stale) sessionStorage.setItem('umple-session-v1', JSON.stringify({ state: {
      modelId: 'old-bookmark', code: 'class Stale {}', activeTabId: 'old',
      tabs: [{ id: 'old', name: 'Stale.ump', code: 'class Stale {}', dirty: false, savedCode: '', undoStack: [], redoStack: [] }],
    }, version: 2 }))
  }, staleSession)
  const requests: GenerationRequest[] = []
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (!path.startsWith('/api/')) return route.fallback()
    if (path === '/api/generate') {
      const body = route.request().postDataJSON() as GenerationRequest
      requests.push(body)
      await route.fulfill({ json: { modelId: body.modelId ?? 'tmpimported', result: '{"umpleClasses":[],"umpleAssociations":[]}', generatedOutput: 'class Generated {}', generatedLanguage: 'Java', svg: '<svg xmlns="http://www.w3.org/2000/svg" />' } })
    } else if (path === '/api/examples') {
      await route.fulfill({ json: [] })
    } else {
      await route.fulfill({ status: 404, json: { error: 'Not found' } })
    }
  })
  return requests
}

function editor(page: Page) { return page.getByTestId('umple-editor').locator('.cm-content').first() }

test('text links replace a stale session and preserve encoded source and URL options', async ({ page }) => {
  const requests = await setup(page, true)
  const code = 'class Manual {\n  String value = "a+b%20<café>";\n}'
  await page.goto(`/?text=${encodeURIComponent(code)}&readOnly&diagramtype=state&generateDefault=Java`)
  await expect(editor(page)).toContainText('class Manual')
  await expect.poll(() => requests.length).toBeGreaterThan(0)
  expect(requests[0].code).toBe(code)
  expect(requests[0].modelId).toBeUndefined()
  expect(requests[0].tabs).toHaveLength(1)
  expect(requests[0].language).toBe('Java')
  await expect(editor(page)).toHaveAttribute('aria-readonly', 'true')
  expect(new URL(page.url()).searchParams.get('text')).toBe(code)
  expect(new URL(page.url()).searchParams.has('model')).toBe(false)
})

test('remote source waits for loading and sharing replaces the import URL', async ({ page }) => {
  const requests = await setup(page, true)
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/source?*', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('filename')).toBe('example.com/Remote.ump')
    await pending
    await route.fulfill({ json: { code: 'class Remote {}' } })
  })
  await page.route('**/api/models/tmpimported/promote', (route) => route.fulfill({ json: { oldId: 'tmpimported', newId: '261011shared' } }))
  await page.goto('/?filename=example.com/Remote.ump')
  await expect(editor(page)).toBeVisible()
  // Wait beyond the compiler debounce while the source is still pending.
  await page.waitForTimeout(1800)
  expect(requests).toHaveLength(0)
  release()
  await expect(editor(page)).toContainText('class Remote')
  await expect.poll(() => requests.length).toBeGreaterThan(0)
  expect(requests[0].modelId).toBeUndefined()
  expect(requests[0].tabs).toHaveLength(1)
  await page.getByTestId('collab-share-btn').click()
  await expect(page).toHaveURL(/model=261011shared/)
  expect(new URL(page.url()).searchParams.has('filename')).toBe(false)
})

test('failed remote source shows an error without compiling the stale session', async ({ page }) => {
  const requests = await setup(page, true)
  await page.route('**/api/source?*', (route) => route.fulfill({ status: 502, json: { error: 'Source server returned HTTP 404' } }))
  await page.goto('/?filename=example.com/missing.ump')
  await expect(page.getByText('Could not load model', { exact: true })).toBeVisible()
  await expect(page.getByText('Source server returned HTTP 404', { exact: true })).toBeVisible()
  await expect(editor(page)).toHaveText('')
  expect(requests).toHaveLength(0)
  expect(new URL(page.url()).searchParams.get('filename')).toBe('example.com/missing.ump')
})

test('saved models win over other source parameters and restore legacy tab names', async ({ page }) => {
  await setup(page, true)
  const sourceRequests: string[] = []
  page.on('request', (request) => {
    if (/\/api\/(source|examples\/resolve)/.test(request.url())) sourceRequests.push(request.url())
  })
  await page.route('**/api/models/160101legacy', (route) => route.fulfill({ json: {
    modelId: '160101legacy', code: 'class Legacy {}', activeTabId: 'main',
    tabs: [{ id: 'main', name: 'model.ump', code: 'class Legacy {}' }, { id: 'Other.ump', name: 'Other.ump', code: 'class Other {}' }],
  } }))
  await page.goto('/?model=160101legacy&example=Ignored&text=ignored&filename=example.com/ignored.ump')
  await expect(editor(page)).toContainText('class Legacy')
  await expect(page.getByRole('tab', { name: /^model(?: Close model\.ump)?$/ })).toBeVisible()
  await page.getByRole('tab', { name: 'Other', exact: true }).click()
  await expect(editor(page)).toContainText('class Other')
  expect(sourceRequests).toEqual([])
})

test('example links win over text and filename and remain until sharing', async ({ page }) => {
  const requests = await setup(page)
  await page.route('**/api/examples/resolve?*', (route) => route.fulfill({ json: {
    id: 'AccessControl', name: 'AccessControl', code: 'class Example {}', modelId: 'tmpexample',
  } }))
  await page.goto('/?example=AccessControl&text=ignored&filename=example.com/ignored.ump')
  await expect(editor(page)).toContainText('class Example')
  await expect.poll(() => requests.length).toBeGreaterThan(0)
  expect(new URL(page.url()).searchParams.get('example')).toBe('AccessControl')
})

test('an explicitly empty text link opens a blank model instead of fetching a file', async ({ page }) => {
  const requests = await setup(page, true)
  await page.goto('/?text=&filename=example.com/ignored.ump')
  await expect(editor(page)).toHaveText('')
  expect(requests).toHaveLength(0)
  expect(new URL(page.url()).searchParams.has('text')).toBe(true)
})


test('legacy manual links decode double-encoded plus signs', async ({ page }) => {
  const requests = await setup(page)
  await page.goto('/?text=class%20Manual%20%7B%20Integer%20sum%20%3D%201%252B2%3B%20%7D')
  await expect(editor(page)).toContainText('1+2')
  await expect.poll(() => requests.length).toBeGreaterThan(0)
  expect(requests[0].code).toBe('class Manual { Integer sum = 1+2; }')
})
