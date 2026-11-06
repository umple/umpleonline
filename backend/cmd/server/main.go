// Package main starts the UmpleOnline API server.
// It loads configuration, opens the model and task stores, and keeps a pool of
// umplesync.jar processes that the HTTP handlers compile against.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/umple/umpleonline/backend/internal/api"
	"github.com/umple/umpleonline/backend/internal/compiler"
	"github.com/umple/umpleonline/backend/internal/config"
	"github.com/umple/umpleonline/backend/internal/model"
	"github.com/umple/umpleonline/backend/internal/task"
)

func main() {
	cfg := config.Load()

	store, err := model.NewStore(cfg.ModelStorePath)
	if err != nil {
		log.Fatalf("failed to initialize model store: %v", err)
	}

	pool, err := compiler.NewPoolWithWorkDir(
		cfg.UmpleSyncJar,
		cfg.UmplePort,
		filepath.Join(cfg.ModelStorePath, ".compiler"),
	)
	if err != nil {
		log.Fatalf("failed to initialize compiler pool: %v", err)
	}
	defer pool.Shutdown()

	go store.CleanupLoop(30 * time.Minute)

	taskStore, err := task.NewStore(cfg.TaskStorePath)
	if err != nil {
		log.Fatalf("failed to initialize task store: %v", err)
	}

	router := api.NewRouter(cfg, pool, store, taskStore)

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Printf("server starting on :%d", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("shutdown error: %v", err)
	}
}
