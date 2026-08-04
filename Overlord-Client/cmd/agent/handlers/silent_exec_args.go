package handlers

import (
	"fmt"
	"strings"
	"unicode"
)

// extractSilentExecArgs accepts either a shell-style string or a string array
// (remote-execute sends args as []string over msgpack).
func extractSilentExecArgs(raw interface{}) []string {
	if raw == nil {
		return []string{}
	}
	switch v := raw.(type) {
	case string:
		return parseCommandArgs(v)
	case []string:
		out := make([]string, 0, len(v))
		for _, arg := range v {
			out = append(out, arg)
		}
		return out
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			switch a := item.(type) {
			case string:
				out = append(out, a)
			case []byte:
				out = append(out, string(a))
			default:
				out = append(out, fmt.Sprint(a))
			}
		}
		return out
	default:
		return parseCommandArgs(fmt.Sprint(v))
	}
}

func parseCommandArgs(input string) []string {
	if strings.TrimSpace(input) == "" {
		return []string{}
	}

	var args []string
	var current []rune
	inSingle := false
	inDouble := false
	escaped := false

	for _, r := range input {
		if escaped {
			current = append(current, r)
			escaped = false
			continue
		}

		if r == '\\' {
			escaped = true
			continue
		}

		if inSingle {
			if r == '\'' {
				inSingle = false
			} else {
				current = append(current, r)
			}
			continue
		}

		if inDouble {
			if r == '"' {
				inDouble = false
			} else {
				current = append(current, r)
			}
			continue
		}

		switch {
		case r == '\'':
			inSingle = true
		case r == '"':
			inDouble = true
		case unicode.IsSpace(r):
			if len(current) > 0 {
				args = append(args, string(current))
				current = nil
			}
		default:
			current = append(current, r)
		}
	}

	if escaped {
		current = append(current, '\\')
	}

	if len(current) > 0 {
		args = append(args, string(current))
	}

	return args
}
