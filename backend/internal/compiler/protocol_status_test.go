package compiler

import (
	"net"
	"strings"
	"testing"
	"time"
)

func TestLogReadTimeoutIsAnError(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	go func() { buffer := make([]byte, 4); server.Read(buffer) }()
	_, err := sendCommandWithTimeout(client, "-log", 20*time.Millisecond)
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("log timeout must be reported, got %v", err)
	}
}

func TestLogReadReturnsCompleteOutput(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	go func() {
		defer server.Close()
		buffer := make([]byte, 4)
		server.Read(buffer)
		server.Write([]byte("Version: 1.37.1\nNumber of commands run since start: 2"))
	}()
	result, err := sendCommandWithTimeout(client, "-log", time.Second)
	if err != nil || !strings.Contains(result.Output, "since start: 2") {
		t.Fatalf("log result=%+v, err=%v", result, err)
	}
}
