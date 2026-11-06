// Package execution forwards a run request to the code-exec service.
// The execute handler calls Proxy after the model has been compiled.
package execution

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Proxy forwards generated code to the code-exec service for running.
type Proxy struct {
	baseURL string
	client  *http.Client
}

// NewProxy creates an execution proxy targeting the given service URL.
func NewProxy(baseURL string) *Proxy {
	return &Proxy{
		baseURL: baseURL,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// RunRequest matches the contract expected by code-exec's POST /run.
type RunRequest struct {
	Path     string `json:"path"`
	Error    string `json:"error"`
	Language string `json:"language"`
}

// ExecuteResponse is returned from the code-exec service.
type ExecuteResponse struct {
	Output string `json:"output"`
	Errors string `json:"errors,omitempty"`
}

// Execute sends the model directory path to the code-exec service for compilation and execution.
func (p *Proxy) Execute(modelPath, compileErrors, language string) (*ExecuteResponse, error) {
	body, err := json.Marshal(RunRequest{
		Path:     modelPath,
		Error:    compileErrors,
		Language: language,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	resp, err := p.client.Post(p.baseURL+"/run", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("execution service unavailable: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("execution service error (status %d): %s", resp.StatusCode, string(respBody))
	}

	var result ExecuteResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &result, nil
}
