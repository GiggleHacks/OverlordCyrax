package capture

import "image"

func webcamTargetSize(width, height, maxHeight int) (int, int) {
	if width <= 0 || height <= 0 || maxHeight <= 0 || height <= maxHeight {
		return width, height
	}
	targetWidth := (width*maxHeight + height/2) / height
	if targetWidth < 1 {
		targetWidth = 1
	}
	return targetWidth, maxHeight
}

func resizeWebcamImage(src image.Image, maxHeight int) image.Image {
	bounds := src.Bounds()
	w, h := webcamTargetSize(bounds.Dx(), bounds.Dy(), maxHeight)
	if w == bounds.Dx() && h == bounds.Dy() {
		return src
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		sy := bounds.Min.Y + y*bounds.Dy()/h
		for x := 0; x < w; x++ {
			sx := bounds.Min.X + x*bounds.Dx()/w
			dst.Set(x, y, src.At(sx, sy))
		}
	}
	return dst
}
