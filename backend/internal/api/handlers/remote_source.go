package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

const maxRemoteSourceBytes = 1 << 20

// These special-use networks are not public source-file destinations, even when
// Go classifies their addresses as global unicast.
var blockedSourceNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("3fff::/20"),
}

func publicSourceIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.Zone() != "" {
		return false
	}
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	for _, prefix := range blockedSourceNetworks {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}

func validateSourceURL(u *url.URL) error {
	if (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Opaque != "" {
		return errors.New("source must be a public HTTP or HTTPS URL without credentials")
	}
	if port := u.Port(); port != "" && port != "80" && port != "443" {
		return errors.New("source URL must use port 80 or 443")
	}
	return nil
}

func parseSourceURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("filename is required")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil, errors.New("invalid source URL")
	}
	if err := validateSourceURL(u); err != nil {
		return nil, err
	}
	return u, nil
}

// Validate at connection time and dial the checked IP, never the hostname a
// second time. This also protects redirects and prevents DNS rebinding. Proxy
// environment variables are deliberately not used for these untrusted URLs.
func dialPublicSource(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, err
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil {
		return nil, errors.New("could not resolve source host")
	}
	if len(ips) == 0 {
		return nil, errors.New("source host has no addresses")
	}
	for _, ip := range ips {
		if !publicSourceIP(ip) {
			return nil, errors.New("source host must resolve only to public Internet addresses")
		}
	}
	var dialer net.Dialer
	for _, ip := range ips {
		conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		err = dialErr
	}
	return nil, err
}

func NewRemoteSourceHandler() http.HandlerFunc {
	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			DialContext:            dialPublicSource,
			TLSHandshakeTimeout:    5 * time.Second,
			ResponseHeaderTimeout:  5 * time.Second,
			DisableKeepAlives:      true,
			MaxResponseHeaderBytes: 32 << 10,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many source redirects")
			}
			return validateSourceURL(req.URL)
		},
	}
	return remoteSourceHandler(client)
}

func remoteSourceHandler(client *http.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		u, err := parseSourceURL(r.URL.Query().Get("filename"))
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, u.String(), nil)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid source URL")
			return
		}
		req.Header.Set("Accept", "text/plain, application/octet-stream;q=0.9")
		res, err := client.Do(req)
		if err != nil {
			writeError(w, http.StatusBadGateway, "could not load source: check that the URL is public and reachable")
			return
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			writeError(w, http.StatusBadGateway, fmt.Sprintf("source server returned HTTP %d", res.StatusCode))
			return
		}
		data, err := io.ReadAll(io.LimitReader(res.Body, maxRemoteSourceBytes+1))
		if err != nil {
			writeError(w, http.StatusBadGateway, "could not read source file")
			return
		}
		if len(data) > maxRemoteSourceBytes {
			writeError(w, http.StatusRequestEntityTooLarge, "source file exceeds 1 MiB")
			return
		}
		if !utf8.Valid(data) || strings.ContainsRune(string(data), '\x00') {
			writeError(w, http.StatusBadGateway, "source file must contain UTF-8 text")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(map[string]string{"code": strings.TrimPrefix(string(data), "\ufeff")})
	}
}
