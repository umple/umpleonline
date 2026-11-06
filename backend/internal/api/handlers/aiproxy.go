package handlers

// AIProxyHandler forwards browser AI requests to an allowlisted provider.
// It is mounted at /api/ai. The browser still sends the API key; this hop is what the provider sees as the caller.

import (
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

// allowedProviders maps provider slugs to their upstream base URLs.
var allowedProviders = map[string]string{
	"openai":     "https://api.openai.com",
	"anthropic":  "https://api.anthropic.com",
	"google":     "https://generativelanguage.googleapis.com",
	"openrouter": "https://openrouter.ai/api",
	"mistral":    "https://api.mistral.ai",
	"xai":        "https://api.x.ai",
	"groq":       "https://api.groq.com",
	"deepseek":   "https://api.deepseek.com",
	"fireworks":  "https://api.fireworks.ai",
	"cerebras":   "https://api.cerebras.ai",
	"moonshot":   "https://api.moonshot.ai",
	"minimax":    "https://api.minimax.io",
	"zhipu":      "https://open.bigmodel.cn",
}

// forwardHeaders is the set of request headers proxied to the upstream provider.
var forwardHeaders = []string{
	"Authorization",
	"X-Api-Key",
	"Content-Type",
	"Accept",
	"X-Goog-Api-Key",    // Google Gemini auth
	"Anthropic-Version", // Anthropic API versioning
}

// AIProxyHandler proxies requests to allowlisted AI provider APIs.
type AIProxyHandler struct {
	client *http.Client
}

// NewAIProxyHandler creates a new AI proxy handler.
func NewAIProxyHandler() *AIProxyHandler {
	return &AIProxyHandler{
		client: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

// Proxy handles requests to /api/ai/{provider}/*
func (h *AIProxyHandler) Proxy(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")

	upstream, ok := allowedProviders[provider]
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown AI provider: "+provider)
		return
	}

	// Extract the remaining path after /api/ai/{provider}/
	// chi wildcard gives us the path via "*"
	remainder := chi.URLParam(r, "*")

	targetURL := upstream + "/" + remainder
	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
	}

	upstreamReq, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create upstream request")
		return
	}

	// Forward allowlisted headers only.
	for _, h := range forwardHeaders {
		if v := r.Header.Get(h); v != "" {
			upstreamReq.Header.Set(h, v)
		}
	}

	log.Printf("ai-proxy: %s %s → %s %s", r.Method, r.URL.Path, provider, targetURL)

	resp, err := h.client.Do(upstreamReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "upstream request failed: "+err.Error())
		return
	}
	defer resp.Body.Close()

	// Copy response headers.
	for k, vs := range resp.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)

	// Stream the response body back to the client.
	// Use Flusher for SSE / streaming responses.
	flusher, canFlush := w.(http.Flusher)
	buf := make([]byte, 32*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := w.Write(buf[:n]); writeErr != nil {
				return
			}
			if canFlush {
				flusher.Flush()
			}
		}
		if readErr != nil {
			break
		}
	}
}

// Routes mounts the AI proxy routes on the given chi router.
func (h *AIProxyHandler) Routes() func(chi.Router) {
	return func(r chi.Router) {
		r.HandleFunc("/{provider}/*", h.Proxy)
	}
}
