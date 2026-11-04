package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestPublicSourceIP(t *testing.T) {
	for _, address := range []string{"127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.100.100.200", "0.0.0.0", "224.0.0.1", "240.0.0.1", "192.0.2.1", "198.18.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:db8::1", "3fff::1"} {
		if publicSourceIP(netip.MustParseAddr(address)) {
			t.Errorf("allowed nonpublic IP %s", address)
		}
	}
	for _, address := range []string{"8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"} {
		if !publicSourceIP(netip.MustParseAddr(address)) {
			t.Errorf("rejected public IP %s", address)
		}
	}
}

func TestSourceURLs(t *testing.T) {
	for _, raw := range []string{"", "file:///etc/passwd", "ftp://example.com/a.ump", "https://user:pass@example.com/a.ump", "https://example.com:3001/a.ump", "https:///a.ump"} {
		if _, err := parseSourceURL(raw); err == nil {
			t.Errorf("accepted %q", raw)
		}
	}
	for _, raw := range []string{"example.com/a.ump", "https://example.com/a.ump?raw=1", "http://example.com/a.ump"} {
		u, err := parseSourceURL(raw)
		if err != nil || u.Hostname() != "example.com" {
			t.Errorf("parse %q: %v, %v", raw, u, err)
		}
	}
}

type sourceTransport func(*http.Request) (*http.Response, error)

func (f sourceTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestRemoteSourceResponses(t *testing.T) {
	for _, tc := range []struct {
		name, body     string
		upstream, want int
	}{
		{"source", "class Example { String text = \"a+b%20<ok>\"; }", 200, 200},
		{"bom", "\ufeffclass Example {}", 200, 200},
		{"empty", "", 200, 200},
		{"missing", "missing", 404, 502},
		{"oversized", strings.Repeat("x", maxRemoteSourceBytes+1), 200, 413},
		{"binary", "\x00\xff", 200, 502},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: sourceTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.String() != "https://example.com/a.ump" {
					t.Errorf("URL = %s", r.URL)
				}
				return &http.Response{StatusCode: tc.upstream, Body: io.NopCloser(strings.NewReader(tc.body)), Header: make(http.Header)}, nil
			})}
			rec := httptest.NewRecorder()
			remoteSourceHandler(client)(rec, httptest.NewRequest("GET", "/api/source?filename=example.com/a.ump", nil))
			if rec.Code != tc.want {
				t.Fatalf("status %d: %s", rec.Code, rec.Body)
			}
			if rec.Code == 200 {
				var result map[string]string
				if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				if result["code"] != strings.TrimPrefix(tc.body, "\ufeff") {
					t.Fatalf("source changed: %q", result["code"])
				}
			}
		})
	}
}

func TestRemoteSourceRejectsPrivateDestination(t *testing.T) {
	for _, host := range []string{"127.0.0.1", "[::1]", "169.254.169.254"} {
		rec := httptest.NewRecorder()
		NewRemoteSourceHandler()(rec, httptest.NewRequest("GET", "/api/source?filename="+url.QueryEscape("http://"+host+"/file.ump"), nil))
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("%s: status %d", host, rec.Code)
		}
	}
}

func TestRemoteSourceRedirectToPrivateHost(t *testing.T) {
	// The first request returns a redirect; subsequent connections use the real
	// guarded dialer. No local server should receive a request.
	transport := &http.Transport{DialContext: dialPublicSource}
	client := &http.Client{Timeout: time.Second, Transport: sourceTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "example.com" {
			return &http.Response{StatusCode: 302, Header: http.Header{"Location": {"http://127.0.0.1/private.ump"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
		}
		return transport.RoundTrip(r)
	}), CheckRedirect: func(r *http.Request, via []*http.Request) error { return validateSourceURL(r.URL) }}
	rec := httptest.NewRecorder()
	remoteSourceHandler(client)(rec, httptest.NewRequest("GET", "/api/source?filename=example.com/a.ump", nil))
	if rec.Code != 502 {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
}

func TestRemoteSourceCancellation(t *testing.T) {
	client := &http.Client{Transport: sourceTransport(func(r *http.Request) (*http.Response, error) {
		<-r.Context().Done()
		return nil, r.Context().Err()
	})}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	rec := httptest.NewRecorder()
	remoteSourceHandler(client)(rec, httptest.NewRequest("GET", "/api/source?filename=example.com/a.ump", nil).WithContext(ctx))
	if rec.Code != 502 {
		t.Fatalf("status %d", rec.Code)
	}
}
