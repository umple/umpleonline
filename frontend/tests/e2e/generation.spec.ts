import { expect, test, type Page } from '@playwright/test'
import type {
  ExampleEntry,
  ExampleResponse,
  ExampleSet,
  GenerationRequest,
} from '../../src/api/types'

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
  { dynamicGeneration = true, showTraits = false }: { dynamicGeneration?: boolean; showTraits?: boolean } = {},
) {
  return page.addInitScript((prefs) => {
    localStorage.setItem(
      'umple-preferences-v1',
      JSON.stringify({
        state: {
          hasSeenWelcome: true,
          dynamicGeneration: prefs.dynamicGeneration,
          showTraits: prefs.showTraits,
        },
        version: 4,
      }),
    )
  }, { dynamicGeneration, showTraits })
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

type ExampleFixture = ExampleEntry & Pick<ExampleResponse, 'setId' | 'defaultCategoryId'>

// A small slice of the example manifest. Auction appears in both the class and
// state menus, as in classic UmpleOnline.
const EXAMPLE_SETS: ExampleSet[] = [
  {
    id: 'example-set-1',
    label: 'Class Diagrams',
    categoryId: 'class',
    examples: [{ id: 'ex-class-auction', name: 'Auction', label: 'Auction *', filename: 'Auction.ump' }],
  },
  {
    id: 'example-set-3',
    label: 'State Machines',
    categoryId: 'state',
    examples: [
      { id: 'ex-state-auction', name: 'Auction', label: 'Auction *', filename: 'Auction.ump' },
      { id: 'ex-state-microwave', name: 'MicrowaveOven2', label: 'Microwave Oven *', filename: 'MicrowaveOven2.ump' },
    ],
  },
  {
    id: 'example-set-5',
    label: 'Composite Structure',
    categoryId: 'structure',
    examples: [{ id: 'ex-structure-pingpong', name: 'PingPong', label: 'Ping Pong', filename: 'PingPong.ump' }],
  },
]

const EXAMPLES_BY_ID = new Map<string, ExampleFixture>(
  EXAMPLE_SETS.flatMap((set) =>
    set.examples.map((example) => [
      example.id,
      { ...example, setId: set.id, defaultCategoryId: set.categoryId },
    ] as const),
  ),
)

// Mirrors the backend: a URL name resolves to its first manifest entry, and a
// library path outside the manifest resolves without a set or category.
const RESOLVED_EXAMPLES: Record<string, ExampleFixture | undefined> = {
  Auction: EXAMPLES_BY_ID.get('ex-class-auction'),
  MicrowaveOven2: EXAMPLES_BY_ID.get('ex-state-microwave'),
  PingPong: EXAMPLES_BY_ID.get('ex-structure-pingpong'),
  'manualexamples/BasicStateMachines1': {
    id: 'ex-library-basic-state-machines',
    name: 'BasicStateMachines1',
    label: 'BasicStateMachines1',
    filename: 'manualexamples/BasicStateMachines1.ump',
  },
}

function findExample(url: URL): ExampleFixture | undefined {
  if (url.pathname === '/api/examples/resolve') {
    return RESOLVED_EXAMPLES[url.searchParams.get('example') ?? '']
  }
  return EXAMPLES_BY_ID.get(url.pathname.split('/').pop() ?? '')
}

function exampleResponse(example: ExampleFixture): ExampleResponse {
  return {
    id: example.id,
    name: example.name,
    label: example.label,
    // The comment keeps different files' code distinct so loading one recompiles.
    code: `class Invoice { number; }\n// ${example.filename}`,
    setId: example.setId,
    defaultCategoryId: example.defaultCategoryId,
  }
}

async function installExampleRoutes(page: Page) {
  await page.route(
    (url) => url.pathname.startsWith('/api/examples'),
    async (route) => {
      const url = new URL(route.request().url())

      if (url.pathname === '/api/examples') {
        await route.fulfill({ json: EXAMPLE_SETS })
        return
      }

      const example = findExample(url)
      if (!example) {
        await route.fulfill({ status: 404, json: { error: 'example not found' } })
        return
      }
      await route.fulfill({ json: exampleResponse(example) })
    },
  )
}

// Seeds what an earlier visit in the same browser tab left in sessionStorage.
function addPersistedSessionInitScript(
  page: Page,
  session: { viewMode: string; generateTargetId: string },
) {
  return page.addInitScript((state) => {
    sessionStorage.setItem('umple-session-v1', JSON.stringify({ state, version: 2 }))
  }, session)
}

// Waits for the compiled class diagram of the requested example, then checks
// that no other diagram or code target was requested on the way, such as one
// left by an earlier session.
async function expectOnlyClassDiagramRequests(
  page: Page,
  requests: GenerationRequest[],
  example: string,
) {
  await expect(page.getByTestId('class-node-Invoice')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('generate-target-wrapper')).toContainText('GraphViz Class Diagram')
  expect(requests.length).toBeGreaterThan(0)
  for (const request of requests) {
    expect(request.code).toContain(`// ${example}.ump`)
    expect(request.diagramType).toBe('GvClassDiagram')
    expect(request.language ?? null).toBe(null)
  }
}

async function pickToolbarExample(page: Page, setLabel: string, exampleLabel: string) {
  await page.getByTestId('app-toolbar').getByRole('button', { name: 'Examples' }).click()
  await page.getByRole('button', { name: setLabel, exact: true }).click()
  await page.getByRole('button', { name: exampleLabel, exact: true }).click()
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

  test('keeps the diagramtype URL option as the output target after compiling', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, requests)

    await page.goto('/?diagramtype=GvState')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')

    await expect
      .poll(() => getLastRequest(requests)?.diagramType)
      .toBe('GvStateDiagram')
    await expect(page.getByTestId('generate-target-wrapper')).toContainText(
      'State Diagram (GraphViz SVG)',
    )
  })

  test('enables traits for the GvClassTrait diagramtype URL option', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, requests)

    await page.goto('/?diagramtype=GvClassTrait')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')

    await expect
      .poll(() => getLastRequest(requests)?.diagramType)
      .toBe('GvClassTraitDiagram')
    await expect(page.getByTestId('generate-target-wrapper')).toContainText(
      'GraphViz Class Diagram',
    )
  })

  test('keeps traits enabled when GvClassTrait is requested again', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page, { showTraits: true })
    await installGenerationRoutes(page, requests)

    await page.goto('/?diagramtype=GvClassTrait')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')

    await expect
      .poll(() => getLastRequest(requests)?.diagramType)
      .toBe('GvClassTraitDiagram')
  })

  test('generates an ordinary class diagram for GvClass when traits were enabled', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page, { showTraits: true })
    await installGenerationRoutes(page, requests)

    await page.goto('/?diagramtype=GvClass')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')

    await expect
      .poll(() => getLastRequest(requests)?.diagramType)
      .toBe('GvClassDiagram')
  })

  test('keeps the traits preference when no diagramtype is requested', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page, { showTraits: true })
    await installGenerationRoutes(page, requests)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')

    await expect
      .poll(() => getLastRequest(requests)?.diagramType)
      .toBe('GvClassTraitDiagram')
  })

  // Classic UmpleOnline opens ?example= as GvClass unless ?diagramtype= says
  // otherwise, whatever menu the example belongs to.
  for (const example of ['MicrowaveOven2', 'PingPong', 'manualexamples/BasicStateMachines1']) {
    test(`opens a bare ${example} example URL as a class diagram after compiling`, async ({ page }) => {
      const requests: GenerationRequest[] = []
      await addPreferencesInitScript(page)
      await installGenerationRoutes(page, requests)
      await installExampleRoutes(page)

      await page.goto(`/?example=${example}`)
      await expect(page.getByTestId('app-shell')).toBeVisible()

      await expectOnlyClassDiagramRequests(page, requests, example)
    })
  }

  const persistedSessions = [
    { example: 'MicrowaveOven2', viewMode: 'state', generateTargetId: 'stateDiagram' },
    { example: 'PingPong', viewMode: 'structure', generateTargetId: 'StructureDiagram' },
    { example: 'manualexamples/BasicStateMachines1', viewMode: 'state', generateTargetId: 'stateDiagram' },
    { example: 'manualexamples/BasicStateMachines1', viewMode: 'feature', generateTargetId: 'featureDiagram' },
    { example: 'MicrowaveOven2', viewMode: 'class', generateTargetId: 'Java' },
  ]
  for (const { example, viewMode, generateTargetId } of persistedSessions) {
    test(`opens a bare ${example} example URL as a class diagram after a ${generateTargetId} session`, async ({ page }) => {
      const requests: GenerationRequest[] = []
      await addPreferencesInitScript(page)
      await addPersistedSessionInitScript(page, { viewMode, generateTargetId })
      await installGenerationRoutes(page, requests)
      await installExampleRoutes(page)

      await page.goto(`/?example=${example}`)
      await expect(page.getByTestId('app-shell')).toBeVisible()

      await expectOnlyClassDiagramRequests(page, requests, example)
    })
  }

  test('restores the previous session target when no example URL is supplied', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await addPersistedSessionInitScript(page, { viewMode: 'state', generateTargetId: 'stateDiagram' })
    await installGenerationRoutes(page, requests)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await setEditorCode(page, 'class Invoice { number; }')

    await expect
      .poll(() => getLastRequest(requests)?.diagramType)
      .toBe('GvStateDiagram')
    await expect(page.getByTestId('generate-target-wrapper')).toContainText(
      'State Diagram (GraphViz SVG)',
    )
  })

  for (const example of ['MicrowaveOven2', 'manualexamples/BasicStateMachines1']) {
    test(`keeps diagramtype=state for the ${example} example URL after compiling`, async ({ page }) => {
      const requests: GenerationRequest[] = []
      await addPreferencesInitScript(page)
      await installGenerationRoutes(page, requests)
      await installExampleRoutes(page)

      await page.goto(`/?example=${example}&diagramtype=state`)
      await expect(page.getByTestId('app-shell')).toBeVisible()

      await expect
        .poll(() => getLastRequest(requests)?.diagramType)
        .toBe('GvStateDiagram')
      await expect(page.getByTestId('generate-target-wrapper')).toContainText(
        'State Diagram (GraphViz SVG)',
      )
    })
  }

  test('keeps an explicit GvClass diagramtype for an example URL', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, requests)
    await installExampleRoutes(page)

    await page.goto('/?example=MicrowaveOven2&diagramtype=GvClass')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await expect
      .poll(() => getLastRequest(requests)?.diagramType)
      .toBe('GvClassDiagram')
    await expect(page.getByTestId('generate-target-wrapper')).toContainText(
      'GraphViz Class Diagram',
    )
  })

  test('enables traits for the GvClassTrait diagramtype on an example URL', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, requests)
    await installExampleRoutes(page)

    await page.goto('/?example=MicrowaveOven2&diagramtype=GvClassTrait')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await expect
      .poll(() => getLastRequest(requests)?.diagramType)
      .toBe('GvClassTraitDiagram')
    await expect(page.getByTestId('generate-target-wrapper')).toContainText(
      'GraphViz Class Diagram',
    )
  })

  test('keeps an explicit generateDefault as the output target after the example loads', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, requests)
    await installExampleRoutes(page)

    await page.goto('/?example=MicrowaveOven2&generateDefault=Java')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await expect
      .poll(() => getLastRequest(requests)?.language)
      .toBe('Java')
    await expect(page.getByTestId('generated-output-highlighted-all-code')).toContainText(
      'InvoiceGenerated',
      { timeout: 10_000 },
    )
    await expect(page.getByTestId('generate-target-wrapper')).toContainText('Java Code')
    expect(requests.some((request) => request.diagramType === 'GvStateDiagram')).toBe(false)
  })

  test('keeps generateDefault as the output target when diagramtype is also requested', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, requests)
    await installExampleRoutes(page)

    await page.goto('/?example=MicrowaveOven2&generateDefault=Java&diagramtype=state')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await expect
      .poll(() => getLastRequest(requests)?.language)
      .toBe('Java')
    await expect(page.getByTestId('generated-output-highlighted-all-code')).toContainText(
      'InvoiceGenerated',
      { timeout: 10_000 },
    )
    await expect(page.getByTestId('generate-target-wrapper')).toContainText('Java Code')
  })

  test('opens a class diagram for an example URL with an invalid generateDefault', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, requests)
    await installExampleRoutes(page)

    await page.goto('/?example=MicrowaveOven2&generateDefault=NotALanguage')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await expectOnlyClassDiagramRequests(page, requests, 'MicrowaveOven2')
  })

  test('switches to the menu category view for an example picked from the toolbar', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, requests)
    await installExampleRoutes(page)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await pickToolbarExample(page, 'State Machines', 'Microwave Oven *')

    await expect
      .poll(() => getLastRequest(requests)?.diagramType)
      .toBe('GvStateDiagram')
    await expect(page.getByTestId('generate-target-wrapper')).toContainText(
      'State Diagram (GraphViz SVG)',
    )
  })

  test('switches to the menu category view for an example picked from the command palette', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, requests)
    await installExampleRoutes(page)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()

    await page.getByRole('button', { name: 'Open command palette' }).click()
    await page.getByTestId('command-palette-input').fill('Ping Pong')
    await page.getByTestId('command-item-example-ex-structure-pingpong').click()

    await expect
      .poll(() => getLastRequest(requests)?.diagramType)
      .toBe('StructureDiagram')
    await expect(page.getByTestId('generate-target-wrapper')).toContainText('Structure Diagram')
  })

  test('opens Auction from both the class and state example menus', async ({ page }) => {
    const requests: GenerationRequest[] = []
    await addPreferencesInitScript(page)
    await installGenerationRoutes(page, requests)
    // Both menus load the same Auction.ump, so the second pick only changes the
    // view, which refreshes the diagram through /api/diagram.
    await installDiagramRoutes(page, requests)
    await installExampleRoutes(page)

    await page.goto('/')
    await expect(page.getByTestId('app-shell')).toBeVisible()
    const examplesButton = page.getByTestId('app-toolbar').getByRole('button', { name: 'Examples' })

    await pickToolbarExample(page, 'Class Diagrams', 'Auction *')
    await expect
      .poll(() => getLastRequest(requests)?.diagramType)
      .toBe('GvClassDiagram')
    await expect(examplesButton).toContainText('Class Diagrams')

    await pickToolbarExample(page, 'State Machines', 'Auction *')
    await expect
      .poll(() => getLastRequest(requests)?.diagramType)
      .toBe('GvStateDiagram')
    await expect(examplesButton).toContainText('State Machines')
    await expect(page.getByTestId('generate-target-wrapper')).toContainText(
      'State Diagram (GraphViz SVG)',
    )
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
