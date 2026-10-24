package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/umple/umpleonline/backend/internal/api/handlers"
	"github.com/umple/umpleonline/backend/internal/compiler"
	"github.com/umple/umpleonline/backend/internal/config"
	"github.com/umple/umpleonline/backend/internal/execution"
	"github.com/umple/umpleonline/backend/internal/model"
	"github.com/umple/umpleonline/backend/internal/task"
)

func NewRouter(cfg *config.Config, pool *compiler.Pool, store *model.Store, taskStore *task.Store) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Content-Type", "Authorization", "X-Api-Key", "X-Goog-Api-Key", "Anthropic-Version"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Existing handlers
	generateH := handlers.NewGenerateHandler(pool, store, cfg)
	exampleH := handlers.NewExampleHandler(cfg, store)
	healthH := handlers.NewHealthHandler(cfg)
	statusH := handlers.NewStatusHandler(cfg, pool)

	// New handlers
	syncH := handlers.NewSyncHandler(pool, store)
	diagramH := handlers.NewDiagramHandler(pool, store)
	exportH := handlers.NewExportHandler(pool, store)
	generatedAssetH := handlers.NewGeneratedAssetHandler(store)
	execProxy := execution.NewProxy(cfg.ExecutionURL)
	executeH := handlers.NewExecuteHandler(pool, store, execProxy)
	modelH := handlers.NewModelHandler(store)
	aiProxyH := handlers.NewAIProxyHandler()
	crudSchemaH := handlers.NewCrudSchemaHandler(pool, store)
	crudDiagramH := handlers.NewCrudDiagramHandler()
	taskH := handlers.NewTaskHandler(taskStore)

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", healthH.Health)
		r.Get("/status", statusH.Status)
		r.Get("/status/summary", statusH.Summary)
		r.Post("/status/visit", statusH.RecordVisit)
		r.Post("/status/session", statusH.RecordSession)

		// Generate (includes compilation)
		r.Post("/generate", generateH.Generate)
		r.Post("/sync", syncH.Sync)
		r.Post("/diagram", diagramH.Generate)
		r.Post("/export", exportH.Export)
		r.Post("/execute", executeH.Execute)
		r.Get("/generated/{modelId}/*", generatedAssetH.Serve)
		r.Post("/crud/schema", crudSchemaH.Schema)
		r.Post("/crud/diagram", crudDiagramH.Render)

		// Models
		r.Get("/models/{id}", modelH.Get)
		r.Post("/models/{id}/promote", modelH.Promote)

		// Examples
		r.Get("/examples", exampleH.List)
		r.Get("/examples/resolve", exampleH.Resolve)
		r.Get("/examples/{id}", exampleH.Get)

		// AI provider proxy (browser → backend → provider)
		r.Route("/ai", aiProxyH.Routes())

		// Tasks
		r.Post("/tasks", taskH.Create)
		r.Get("/tasks/{name}", taskH.Get)
		r.Put("/tasks/{name}", taskH.Update)
		r.Post("/tasks/{name}/responses", taskH.CreateResponse)
		r.Get("/tasks/responses/{id}", taskH.GetResponse)
		r.Post("/tasks/responses/{id}/submit", taskH.SubmitResponse)
		r.Get("/tasks/{name}/responses", taskH.ListResponses)
	})

	return r
}
