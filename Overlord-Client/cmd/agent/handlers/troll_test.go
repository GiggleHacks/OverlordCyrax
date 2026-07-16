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
		{"http://localhost:3000", "http://localhost:3000", false},
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
