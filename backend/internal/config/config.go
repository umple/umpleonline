package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port             int
	UmpleSyncJar     string
	UmplePort        int
	ModelStorePath   string
	ExamplePath      string
	ExampleLibrary   string
	ExampleCachePath string
	ExecutionURL     string
	CollabURL        string
	LSPURL           string
	TaskStorePath    string
	AllowedOrigins   []string
}

func Load() *Config {
	return &Config{
		Port:             getEnvInt("PORT", 3001),
		UmpleSyncJar:     getEnv("UMPLE_SYNC_JAR", "/jars/umplesync.jar"),
		UmplePort:        getEnvInt("UMPLE_PORT", 5555),
		ModelStorePath:   getEnv("MODEL_STORE_PATH", "/data/models"),
		ExamplePath:      getEnv("EXAMPLE_PATH", "/examples"),
		ExampleLibrary:   getEnv("EXAMPLE_LIBRARY_URL", "https://umple.org/umpleonline/umplibrary"),
		ExampleCachePath: getEnv("EXAMPLE_CACHE_PATH", "/data/models/examples"),
		ExecutionURL:     getExecutionURL(),
		CollabURL:        getCollabURL(),
		LSPURL:           getLSPURL(),
		TaskStorePath:    getEnv("TASK_STORE_PATH", "/data/models/tasks"),
		AllowedOrigins:   getOrigins("ALLOWED_ORIGINS", []string{"http://localhost:3100"}),
	}
}

func getExecutionURL() string {
	if v := os.Getenv("EXECUTION_URL"); v != "" {
		return v
	}

	return fmt.Sprintf("http://code-exec:%d", getEnvInt("CODE_EXEC_PORT", 4401))
}

func getCollabURL() string {
	if v := os.Getenv("COLLAB_URL"); v != "" {
		return v
	}

	return fmt.Sprintf("http://collab:%d", getEnvInt("COLLAB_PORT", 3002))
}

func getLSPURL() string {
	if v := os.Getenv("LSP_URL"); v != "" {
		return v
	}

	return fmt.Sprintf("http://lsp-proxy:%d", getEnvInt("LSP_PORT", 9999))
}

func getOrigins(key string, fallback []string) []string {
	if v := os.Getenv(key); v != "" {
		parts := strings.Split(v, ",")
		origins := make([]string, 0, len(parts))
		for _, p := range parts {
			if s := strings.TrimSpace(p); s != "" {
				origins = append(origins, s)
			}
		}
		return origins
	}
	return fallback
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
