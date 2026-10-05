package handlers

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
)

type CompilerSummary struct {
	Version            string `json:"version,omitempty"`
	CommandsSinceStart *int64 `json:"commandsSinceStart,omitempty"`
	CommandsHistorical *int64 `json:"commandsHistorical,omitempty"`
}

type StatusSummary struct {
	Status    string          `json:"status"`
	Compiler  CompilerSummary `json:"compiler"`
	Visits    *int            `json:"visits,omitempty"`
	Sessions  *int            `json:"sessions,omitempty"`
	Branch    string          `json:"branch,omitempty"`
	Commit    string          `json:"commit,omitempty"`
	UpdatedAt string          `json:"updatedAt,omitempty"`
}

var compilerVersionPattern = regexp.MustCompile(`(?m)^Version: ([^\s]+)`)
var compilerCommandsPattern = regexp.MustCompile(`(?m)^Number of commands run since start: (\d+)`)
var compilerHistoricalPattern = regexp.MustCompile(`(?m)^Number of commands run since July 2019: (\d+)`)

func parseCompilerSummary(log string) CompilerSummary {
	result := CompilerSummary{}
	if match := compilerVersionPattern.FindStringSubmatch(log); len(match) == 2 {
		result.Version = match[1]
	}
	result.CommandsSinceStart = parseLogCount(compilerCommandsPattern, log)
	result.CommandsHistorical = parseLogCount(compilerHistoricalPattern, log)
	return result
}

func parseLogCount(pattern *regexp.Regexp, log string) *int64 {
	match := pattern.FindStringSubmatch(log)
	if len(match) != 2 {
		return nil
	}
	value, err := strconv.ParseInt(match[1], 10, 64)
	if err != nil {
		return nil
	}
	return &value
}

func (h *StatusHandler) summary(compiler map[string]any) StatusSummary {
	log, _ := compiler["log"].(string)
	result := StatusSummary{Status: "ok", Compiler: parseCompilerSummary(log)}
	if compiler["status"] != "ok" || result.Compiler.Version == "" || result.Compiler.CommandsHistorical == nil {
		result.Status = "degraded"
	}
	h.mu.Lock()
	counters, err := h.readCounters()
	h.mu.Unlock()
	if err == nil {
		result.Visits = &counters.VisitsStarted
		result.Sessions = &counters.SessionsStarted
	} else {
		result.Status = "degraded"
	}
	build := buildStatus()
	result.Branch, _ = build["sourceRefName"].(string)
	result.Commit, _ = build["sourceCommit"].(string)
	result.UpdatedAt = firstPresent(getBuildValue(releaseStatus(), "deployedAt"), getBuildValue(build, "builtAt"))
	return result
}

func getBuildValue(build map[string]any, key string) string {
	value, _ := build[key].(string)
	return value
}

func (h *StatusHandler) Summary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(h.summary(h.umplesyncStatus()))
}
