package compiler

import (
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"time"
)

const (
	errorPrefix = "ERROR!!"
	errorSuffix = "!!ERROR"
	readBufSize = 65534
	readTimeout = 1500 * time.Millisecond
	readDelay   = 50 * time.Millisecond
)

// sendCommand sends a raw command string over a TCP connection and reads
// the response, parsing the ERROR!!...!!ERROR framing protocol used by
// umplesync.jar server mode.
func sendCommand(conn net.Conn, command string) (*CompileResult, error) {
	return sendCommandWithTimeout(conn, command, readTimeout)
}

func sendCommandWithTimeout(conn net.Conn, command string, timeout time.Duration) (*CompileResult, error) {
	// Send command
	_, err := conn.Write([]byte(command))
	if err != nil {
		return nil, fmt.Errorf("write failed: %w", err)
	}

	// Read response with error framing
	var output strings.Builder
	var errs strings.Builder
	hasMoreError := false

	for {
		conn.SetReadDeadline(time.Now().Add(timeout))
		buf := make([]byte, readBufSize)
		n, err := conn.Read(buf)

		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				if command == "-log" {
					return nil, fmt.Errorf("compiler log response timed out: %w", err)
				}
				// Timeout means no more data — normal termination
				break
			}
			// EOF is normal — server closes connection after response.
			// File-based generators (e.g. -generate Java) may close
			// without sending any body bytes, which is still success.
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, fmt.Errorf("read failed: %w", err)
		}

		if n == 0 {
			break
		}

		chunk := string(buf[:n])

		if hasMoreError {
			// Continue reading error content
			endIdx := strings.Index(chunk, errorSuffix)
			if endIdx == -1 {
				errs.WriteString(chunk)
			} else {
				errs.WriteString(chunk[:endIdx])
				hasMoreError = false
				rest := chunk[endIdx+len(errorSuffix):]
				if len(rest) > 0 {
					output.WriteString(rest)
				}
			}
		} else if strings.HasPrefix(chunk, errorPrefix) {
			// Start of error framing
			content := chunk[len(errorPrefix):]
			endIdx := strings.Index(content, errorSuffix)
			if endIdx == -1 {
				errs.WriteString(content)
				hasMoreError = true
			} else {
				errs.WriteString(content[:endIdx])
				rest := content[endIdx+len(errorSuffix):]
				if len(rest) > 0 {
					output.WriteString(rest)
				}
			}
		} else {
			output.WriteString(chunk)
		}

		time.Sleep(readDelay)
	}

	return &CompileResult{
		Output: output.String(),
		Errors: errs.String(),
	}, nil
}
