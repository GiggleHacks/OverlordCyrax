package handlers

import "testing"

func TestNormalizeOpenURL(t *testing.T) {
	tests := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"https://example.com/path", "https://example.com/path", false},
		{"example.com", "https://example.com", false},
		{"www.example.com", "https://www.example.com", false},
		{"http://localhost:3000", "http://localhost:3000", false},
		{"http:example.com/path", "http://example.com/path", false},
		{"https:www.example.com", "https://www.example.com", false},
		{"//example.com/x", "https://example.com/x", false},
		{"", "", true},
		{"ftp://example.com", "", true},
		{"file:///etc/passwd", "", true},
	}
	for _, tt := range tests {
		got, err := normalizeOpenURL(tt.in)
		if tt.wantErr {
			if err == nil {
				t.Fatalf("normalizeOpenURL(%q) expected error", tt.in)
			}
			continue
		}
		if err != nil {
			t.Fatalf("normalizeOpenURL(%q) unexpected error: %v", tt.in, err)
		}
		if got != tt.want {
			t.Fatalf("normalizeOpenURL(%q)=%q want %q", tt.in, got, tt.want)
		}
	}
}

func TestNormalizeMessageBoxIcon(t *testing.T) {
	if got := normalizeMessageBoxIcon("ALERT"); got != "warning" {
		t.Fatalf("got %q", got)
	}
	if got := normalizeMessageBoxIcon(""); got != "info" {
		t.Fatalf("got %q", got)
	}
	if got := normalizeMessageBoxIcon("Error"); got != "error" {
		t.Fatalf("got %q", got)
	}
}

func TestNormalizeCursorBigDuration(t *testing.T) {
	got, err := normalizeCursorBigDuration(map[string]interface{}{})
	if err != nil || got != 30 {
		t.Fatalf("default got %d err %v", got, err)
	}
	got, err = normalizeCursorBigDuration(map[string]interface{}{"durationSec": float64(60)})
	if err != nil || got != 60 {
		t.Fatalf("60 got %d err %v", got, err)
	}
	if _, err := normalizeCursorBigDuration(map[string]interface{}{"durationSec": float64(2)}); err == nil {
		t.Fatal("expected error for duration 2")
	}
	if _, err := normalizeCursorBigDuration(map[string]interface{}{"durationSec": float64(999)}); err == nil {
		t.Fatal("expected error for duration 999")
	}
}
