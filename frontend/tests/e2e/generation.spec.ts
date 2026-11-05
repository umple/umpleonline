import { expect, test, type Page } from '@playwright/test'
import type { GenerationRequest } from '../../src/api/types'

test.describe.configure({ timeout: 45_000 })

function buildClassModel(code: string) {
  const className = code.includes('UpdatedInvoice') ? 'UpdatedInvoice' : 'Invoice'
  return {
    umpleClasses: [
      {
        name: className,
        attributes: [{ name: 'number', type: '' }],
        methods: [],
      },
    ],
    umpleAssociations: [],
  }
}

function getLastRequest(requests: GenerationRequest[]) {
  return requests[requests.length - 1]
}

function addPreferencesInitScript(
  page: Page,
  { dynamicGeneration = true }: { dynamicGeneration?: boolean } = {},
) {
  return page.addInitScript((prefs) => {
    localStorage.setItem(
      'umple-preferences-v1',
      JSON.stringify({
        state: {
          hasSeenWelcome: true,
          dynamicGeneration: prefs.dynamicGeneration,
        },
        version: 4,
      }),
    )
  }, { dynamicGeneration })
}

async function setEditorCode(page: Page, code: string) {
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(code, { delay: 0 })
}

async function chooseGenerateTarget(page: Page, targetId: string) {
  await page.getByRole('button', { name: 'Open command palette' }).click()
  await expect(page.getByTestId('command-palette')).toBeVisible()
  await page.getByTestId('command-palette-input').fill(targetId)
  await page.getByTestId(`command-item-gen-${targetId}`).click()
}

async function chooseToolbarGenerateTarget(page: Page, query: string, label: string) {
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
  await page.getByPlaceholder('Search targets...').fill(query)
  await page.getByText(label, { exact: true }).click()
}

async function installGenerationRoutes(page: Page, requests: GenerationRequest[]) {
  await page.route('**/api/examples', async (route) => {
    await route.fulfill({ json: [] })
  })

  await page.route('**/api/generate', async (route) => {
    const body = route.request().postDataJSON() as GenerationRequest
    requests.push(body)
    const classModel = buildClassModel(body.code)

    if (body.code.includes('number }')) {
      await route.fulfill({
        json: {
          modelId: 'playwright-model',
          result: JSON.stringify(classModel),
          errors: '{"results":[{"severity":"1","message":"Syntax error","line":"1"}]}',
        },
      })
      return
    }

    if (body.language === 'Java') {
      const className = body.code.includes('UpdatedInvoice')
        ? 'UpdatedInvoiceGenerated'
        : 'InvoiceGenerated'

      await route.fulfill({
        json: {
          modelId: 'playwright-model',
          result: JSON.stringify(classModel),
          generatedOutput: [
            `package billing;`,
            '',
            `public class ${className} {`,
            '  public String getNumber() { return number; }',
            '}',
            '',
            'package billing;',
            '',
            'public class CustomerGenerated {',
            '  public String getName() { return name; }',
            '}',
          ].join('\n'),
          generatedLanguage: 'Java',
          generatedKind: 'text',
          generatedFiles: [
            {
              name: `${className}.java`,
              path: `billing/${className}.java`,
              content: [
                'package billing;',
                '',
                `public class ${className} {`,
                '  public String getNumber() { return number; }',
                '}',
              ].join('\n'),
            },
            {
              name: 'CustomerGenerated.java',
              path: 'billing/CustomerGenerated.java',
              content: [
                'package billing;',
                '',
                'public class CustomerGenerated {',
                '  public String getName() { return name; }',
                '}',
              ].join('\n'),
            },
          ],
        },
      })
      return
    }

    if (body.language === 'SimpleMetrics') {
      await route.fulfill({
        json: {
          modelId: 'playwright-model',
          result: JSON.stringify(classModel),
          generatedHtml: '<html><body><h1>Simple Metrics Report</h1><p>Total classes: 1</p></body></html>',
          generatedLanguage: 'SimpleMetrics',
          generatedKind: 'html',
        },
      })
      return
    }

    if (body.language === 'javadoc') {
      await route.fulfill({
        json: {
          modelId: 'playwright-model',
          result: JSON.stringify(classModel),
          generatedLanguage: 'javadoc',
          generatedKind: 'iframe',
          generatedIframeUrl: 'https://example.test/generated/javadoc/index.html',
          generatedDownloads: [
            {
              label: 'Download API Docs',
              url: '/api/generated/playwright-model/javadoc.zip',
              filename: 'javadoc.zip',
            },
          ],
        },
      })
      return
    }

    if (body.diagramType === 'StructureDiagram') {
      await route.fulfill({
        json: {
          modelId: 'playwright-model',
          result: JSON.stringify(classModel),
          html: '<html><body><div>Structure Diagram Output</div></body></html>',
        },
      })
      return
    }

    await route.fulfill({
      json: {
        modelId: 'playwright-model',
        result: JSON.stringify(classModel),
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
      },
    })
  })
}

async function installDiagramRoutes(page: Page, requests: GenerationRequest[]) {
  await page.route('**/api/diagram', async (route) => {
    const body = route.request().postDataJSON() as GenerationRequest
    requests.push(body)
    await route.fulfill({
      json: {
        modelId: 'playwright-model',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
      },
    })
  })
}

test.describe('Generation UI', () => {
  test('uses class diagram generation as the default output target', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, requests)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')

    await expect(page.getByTestId('class-node-Invoice')).toBeVisible({
      timeout: 10_000,
    })
    await expect
      .poll(() => getLastRequest(requests)?.diagramType)
      .toBe('GvClassDiagram')
    await expect
      .poll(() => getLastRequest(requests)?.language ?? null)
      .toBe(null)
  })

  test('keeps all generated code visible by default and offers per-file tabs', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page, { dynamicGeneration: false })
    await installGenerationRoutes(page, requests)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }\nclass Customer { name; }')
    await chooseGenerateTarget(page, 'Java')

    await expect(page.getByTestId('generated-output-all-code')).toContainText('public class InvoiceGenerated')
    await expect(page.getByTestId('generated-output-all-code')).toContainText('public class CustomerGenerated')
    await expect(page.getByRole('tab', { name: 'All code' })).toHaveAttribute('data-state', 'active')

    await page.getByRole('tab', { name: 'CustomerGenerated.java' }).click()

    await expect(page.getByTestId('code-output')).toContainText('public class CustomerGenerated')
  })

  test('refetches class diagrams with legacy filter fields and keeps the renderer toggle working', async ({
    page,
  }) => {
    const generateRequests: GenerationRequest[] = []
    const diagramRequests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, generateRequests)
    await installDiagramRoutes(page, diagramRequests)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, [
      'filter Focus {',
      '  include Invoice;',
      '}',
      'mixset Metrics {',
      '}',
      'class Invoice { number; }',
      'class ArchivedInvoice { number; }',
    ].join('\n'))

    await expect(page.getByTestId('class-node-Invoice')).toBeVisible({
      timeout: 10_000,
    })

    await page.getByTestId('canvas-display-options-button').click()
    const filterInput = page.getByTestId('class-filter-input')
    await filterInput.fill('Invoice ~ArchivedInvoice 2 gvseparator=1.7')
    await filterInput.press('Enter')

    await expect
      .poll(() => diagramRequests[diagramRequests.length - 1]?.classFilterQuery)
      .toBe('Invoice ~ArchivedInvoice 2 gvseparator=1.7')

    await page.getByTestId('class-filter-named-filter-Focus').click()
    await page.getByTestId('class-filter-mixset-Metrics').click()

    await expect
      .poll(() => diagramRequests[diagramRequests.length - 1])
      .toMatchObject({
        classFilterQuery: 'Invoice ~ArchivedInvoice 2 gvseparator=1.7',
        namedFilters: ['Focus'],
        mixsets: ['Metrics'],
      })

    const rendererToggle = page.getByRole('switch', { name: 'Edit GV' })
    await rendererToggle.click()
    await rendererToggle.click()

    await expect(page.getByTestId('class-node-Invoice')).toBeVisible()
  })

  test('keeps the last diagram visible after a compile error in dynamic mode', async ({
    page,
  }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, requests)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')
    await expect(page.getByTestId('class-node-Invoice')).toBeVisible({
      timeout: 10_000,
    })

    await setEditorCode(page, 'class Invoice { number }')

    await expect(page.getByTestId('diagram-output-stale-overlay')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByTestId('class-node-Invoice')).toBeVisible()
    await expect(page.getByText('Fix the error in the code.')).toBeVisible()
    await expect(page.getByTestId('regenerate-button')).toBeVisible()

    const retryResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/generate') && response.request().method() === 'POST',
    )
    await page.getByTestId('regenerate-button').click()
    await retryResponse
    expect(requests).toHaveLength(3)
  })

  test('keeps regenerate available after a compile error in manual mode', async ({
    page,
  }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page, { dynamicGeneration: false })
    await installGenerationRoutes(page, requests)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')
    let regenerateResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/generate') && response.request().method() === 'POST',
    )
    await page.getByTestId('regenerate-button').click()
    await regenerateResponse

    await expect(page.getByTestId('class-node-Invoice')).toBeVisible({
      timeout: 10_000,
    })

    await setEditorCode(page, 'class Invoice { number }')
    await expect(page.getByTestId('diagram-output-stale-overlay')).toBeVisible()
    await expect(page.getByText('Use Regenerate above to refresh it.')).toBeVisible()
    await expect(page.getByTestId('regenerate-button')).toBeVisible()

    regenerateResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/generate') && response.request().method() === 'POST',
    )
    await expect(page.getByTestId('regenerate-button')).toBeEnabled()
    await page.getByTestId('regenerate-button').click()
    await regenerateResponse

    expect(requests).toHaveLength(2)
    await expect(page.getByText('Fix the error in the code.')).toBeVisible()
    await expect(page.getByTestId('regenerate-button')).toBeEnabled()

    regenerateResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/generate') && response.request().method() === 'POST',
    )
    await page.getByTestId('regenerate-button').click()
    await regenerateResponse

    expect(requests).toHaveLength(3)
  })

  test('preserves stale generated code until manual regenerate when dynamic generation is off', async ({
    page,
  }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page, { dynamicGeneration: false })
    await installGenerationRoutes(page, requests)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')
    await chooseGenerateTarget(page, 'Java')

    await expect(page.getByTestId('generated-output-highlighted-all-code')).toContainText(
      'InvoiceGenerated',
      { timeout: 10_000 },
    )
    await expect(page.getByTestId('regenerate-button')).toBeVisible()
    await expect(page.getByTestId('generated-output-stale-overlay')).toHaveCount(0)
    expect(getLastRequest(requests)?.language).toBe('Java')

    await setEditorCode(page, 'class UpdatedInvoice { number; }')

    await expect(page.getByTestId('generated-output-stale-overlay')).toBeVisible()
    expect(requests).toHaveLength(1)
    await expect(page.getByTestId('generated-output-highlighted-all-code')).toContainText(
      'InvoiceGenerated',
    )

    const regenerateResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/generate') && response.request().method() === 'POST',
    )
    await page.getByTestId('regenerate-button').click()
    await regenerateResponse

    expect(requests).toHaveLength(2)
    expect(getLastRequest(requests)?.language).toBe('Java')
    await expect(page.getByTestId('generated-output-highlighted-all-code')).toContainText(
      'UpdatedInvoiceGenerated',
      { timeout: 10_000 },
    )
    await expect(page.getByTestId('generated-output-stale-overlay')).toHaveCount(0)
  })

  test('keeps generated code visible when switching to a diagram target in manual mode', async ({
    page,
  }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page, { dynamicGeneration: false })
    await installGenerationRoutes(page, requests)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')
    await chooseGenerateTarget(page, 'Java')

    await expect(page.getByTestId('generated-output-highlighted-all-code')).toContainText(
      'InvoiceGenerated',
      { timeout: 10_000 },
    )
    expect(getLastRequest(requests)?.language).toBe('Java')

    await chooseToolbarGenerateTarget(page, 'State Diagram', 'State Diagram (GraphViz SVG)')
    await page.waitForTimeout(300)

    expect(requests).toHaveLength(1)
    await expect(page.getByTestId('generated-output-highlighted-all-code')).toContainText(
      'InvoiceGenerated',
    )
    await expect(page.getByTestId('generated-output-stale-overlay')).toBeVisible()

    const regenerateResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/generate') && response.request().method() === 'POST',
    )
    await page.getByTestId('regenerate-button').click()
    await regenerateResponse

    expect(requests).toHaveLength(2)
    expect(getLastRequest(requests)?.diagramType).toBe('GvStateDiagram')
  })

  test('does not auto-generate when changing the target while dynamic generation is off', async ({
    page,
  }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page, { dynamicGeneration: false })
    await installGenerationRoutes(page, requests)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')
    await page.waitForTimeout(900)
    expect(requests).toHaveLength(0)

    await chooseToolbarGenerateTarget(page, 'Java', 'Java Code')
    await page.waitForTimeout(300)

    expect(requests).toHaveLength(0)
    await expect(page.getByTestId('regenerate-button')).toBeVisible()

    const regenerateResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/generate') && response.request().method() === 'POST',
    )
    await page.getByTestId('regenerate-button').click()
    await regenerateResponse

    expect(requests).toHaveLength(1)
    expect(getLastRequest(requests)?.language).toBe('Java')
    await expect(page.getByTestId('generated-output-highlighted-all-code')).toContainText(
      'InvoiceGenerated',
      { timeout: 10_000 },
    )
  })

  test('greys stale diagrams until manual regenerate when dynamic generation is off', async ({
    page,
  }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page, { dynamicGeneration: false })
    await installGenerationRoutes(page, requests)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')

    const firstRegenerateResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/generate') && response.request().method() === 'POST',
    )
    await page.getByTestId('regenerate-button').click()
    await firstRegenerateResponse

    await expect(page.getByTestId('class-node-Invoice')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('diagram-output-stale-overlay')).toHaveCount(0)
    expect(getLastRequest(requests)?.diagramType).toBe('GvClassDiagram')

    await setEditorCode(page, 'class UpdatedInvoice { number; }')

    await expect(page.getByTestId('diagram-output-stale-overlay')).toBeVisible()
    expect(requests).toHaveLength(1)
    await expect(page.getByTestId('class-node-Invoice')).toBeVisible()

    const secondRegenerateResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/generate') && response.request().method() === 'POST',
    )
    await page.getByTestId('regenerate-button').click()
    await secondRegenerateResponse

    expect(requests).toHaveLength(2)
    expect(getLastRequest(requests)?.diagramType).toBe('GvClassDiagram')
    await expect(page.getByTestId('diagram-output-stale-overlay')).toHaveCount(0)
  })

  test('keeps the current output visible when switching targets in manual mode until regenerate', async ({
    page,
  }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page, { dynamicGeneration: false })
    await installGenerationRoutes(page, requests)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')

    const firstRegenerateResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/generate') && response.request().method() === 'POST',
    )
    await page.getByTestId('regenerate-button').click()
    await firstRegenerateResponse

    await expect(page.getByTestId('class-node-Invoice')).toBeVisible({ timeout: 10_000 })
    expect(getLastRequest(requests)?.diagramType).toBe('GvClassDiagram')

    await chooseToolbarGenerateTarget(page, 'State Diagram', 'State Diagram (GraphViz SVG)')
    await page.waitForTimeout(300)

    expect(requests).toHaveLength(1)
    await expect(page.getByTestId('class-node-Invoice')).toBeVisible()
    await expect(page.getByTestId('diagram-output-stale-overlay')).toBeVisible()

    const secondRegenerateResponse = page.waitForResponse(
      (response) =>
        response.url().includes('/api/generate') && response.request().method() === 'POST',
    )
    await page.getByTestId('regenerate-button').click()
    await secondRegenerateResponse

    expect(requests).toHaveLength(2)
    expect(getLastRequest(requests)?.diagramType).toBe('GvStateDiagram')
    await expect(page.getByTestId('diagram-output-stale-overlay')).toHaveCount(0)
  })

  test('renders HTML diagrams in the canvas when the selected target is a diagram with HTML output', async ({
    page,
  }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, requests)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Component1 { public in Integer pIn1; }\nclass Atomic { Component1 cmp1; }')
    await chooseToolbarGenerateTarget(page, 'Structure', 'Structure Diagram')

    await expect(page.getByTestId('html-diagram-iframe')).toBeVisible({
      timeout: 10_000,
    })
    await expect
      .poll(() => getLastRequest(requests)?.diagramType)
      .toBe('StructureDiagram')
  })

  test('renders generated HTML and iframe outputs for non-diagram targets', async ({
    page,
  }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, requests)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')

    await chooseGenerateTarget(page, 'SimpleMetrics')
    await expect(page.getByTitle('Generated HTML output')).toBeVisible({
      timeout: 10_000,
    })
    expect(getLastRequest(requests)?.language).toBe('SimpleMetrics')

    await chooseGenerateTarget(page, 'javadoc')
    await expect(page.getByTitle('Generated output')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByRole('link', { name: 'Download API Docs' })).toBeVisible()
    expect(getLastRequest(requests)?.language).toBe('javadoc')
  })
})


test('common output shortcuts work with automatic generation disabled', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  const requests: GenerationRequest[] = []
  await addPreferencesInitScript(page, { dynamicGeneration: false })
  await installGenerationRoutes(page, requests)
  await page.goto('/')
  await setEditorCode(page, 'class Invoice { number; }')

  await expect(page.getByTestId('execute-button')).toBeInViewport()
  await page.getByTestId('quick-output-Java').click()
  await expect(page.getByTestId('generated-output-all-code')).toContainText('public class InvoiceGenerated')
  expect(getLastRequest(requests)?.language).toBe('Java')

  await page.getByTestId('quick-output-classDiagram').click()
  await expect(page.getByTestId('quick-output-classDiagram')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => getLastRequest(requests)?.diagramType).toBe('GvClassDiagram')
  await expect(page.getByTestId('generated-output-all-code')).toBeHidden()

  await page.getByTestId('quick-output-stateDiagram').click()
  await expect.poll(() => getLastRequest(requests)?.diagramType).toBe('GvStateDiagram')
  await expect(page.getByTestId('quick-output-stateDiagram')).toHaveAttribute('aria-pressed', 'true')
})

test('executes from a diagram without generating visible code and offers Python execution', async ({ page }) => {
  const requests: GenerationRequest[] = []
  const executions: Array<{ language: string; code: string; tabs: Array<{ code: string }> }> = []
  await addPreferencesInitScript(page, { dynamicGeneration: false })
  await installGenerationRoutes(page, requests)
  await page.route('**/api/execute', async (route) => {
    executions.push(route.request().postDataJSON())
    await route.fulfill({ json: { output: 'Program output', modelId: 'execution-model' } })
  })
  await page.goto('/')
  await setEditorCode(page, 'class Invoice { number; }')
  await page.getByTestId('quick-output-classDiagram').click()
  await expect.poll(() => requests.length).toBe(1)
  await expect(page.getByTestId('quick-output-classDiagram')).toBeEnabled()

  await page.getByTestId('execute-button').click()
  await expect(page.getByTestId('output-panel')).toContainText('Program output')
  expect(executions[0]).toMatchObject({ language: 'Java', code: 'class Invoice { number; }', tabs: [{ code: 'class Invoice { number; }' }] })
  expect(requests).toHaveLength(1)
  await expect(page.getByTestId('quick-output-classDiagram')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('generated-output-all-code')).toBeHidden()

  await page.getByRole('button', { name: 'Execution language', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Execute Python', exact: true }).click()
  await expect.poll(() => executions.length).toBe(2)
  expect(executions[1]?.language).toBe('Python')
  await expect(page.getByTestId('quick-output-classDiagram')).toHaveAttribute('aria-pressed', 'true')
})
