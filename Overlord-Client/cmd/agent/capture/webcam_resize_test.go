package capture

import "testing"

func TestWebcamTargetSizePreservesAspectRatio(t *testing.T) {
	w, h := webcamTargetSize(1920, 1080, 360)
	if w != 640 || h != 360 {
		t.Fatalf("expected 640x360, got %dx%d", w, h)
	}
}

func TestWebcamTargetSizeKeepsNativeAndNeverUpscales(t *testing.T) {
	for _, maxHeight := range []int{-1, 0, 1080} {
		w, h := webcamTargetSize(640, 480, maxHeight)
		if w != 640 || h != 480 {
			t.Fatalf("maxHeight=%d: expected 640x480, got %dx%d", maxHeight, w, h)
		}
	}
}
