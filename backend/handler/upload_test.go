package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/pborman/uuid"
	"networkai/model"
)

func TestMultipartUpload(t *testing.T) {
	png, err := os.ReadFile("../examples/lesson33.png")
	if err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		name, filename, peer, wantMIME, wantType string
		saveError                                error
		wantStatus                               int
	}{
		{"image", "photo.PNG", "127.0.0.1:1234", "image/png", "image", nil, 200},
		{"video", "clip.mp4", "[::1]:1234", "video/mp4", "video", nil, 200},
		{"missing media", "", "127.0.0.1:1234", "", "", nil, 400},
		{"unsupported media", "page.html", "127.0.0.1:1234", "", "", nil, 415},
		{"authenticated nonlocal upload", "photo.png", "192.0.2.1:1234", "image/png", "image", nil, 200},
		{"storage failure", "photo.png", "127.0.0.1:1234", "image/png", "image", errors.New("storage offline"), 500},
	} {
		t.Run(tt.name, func(t *testing.T) {
			media := png
			if tt.filename == "clip.mp4" {
				media = []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0, 'i', 's', 'o', 'm', 'm', 'p', '4', '2'}
			}
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			if err := form.WriteField("user", "impersonated"); err != nil {
				t.Fatal(err)
			}
			if err := form.WriteField("message", "你好，Lesson33"); err != nil {
				t.Fatal(err)
			}
			if tt.filename != "" {
				file, err := form.CreateFormFile("media_file", tt.filename)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := file.Write(media); err != nil {
					t.Fatal(err)
				}
			}
			if err := form.Close(); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "/posts", &body)
			request = request.WithContext(context.WithValue(request.Context(), usernameContextKey{}, "vincent"))
			request.RemoteAddr = tt.peer
			request.Header.Set("Content-Type", form.FormDataContentType())
			request.Header.Set("X-Forwarded-For", "127.0.0.1")
			response := httptest.NewRecorder()
			called := false
			uploadHandler(func(_ context.Context, post *model.Post, file io.Reader, _ string, contentType string) error {
				called = true
				data, err := io.ReadAll(file)
				if err != nil || !bytes.Equal(data, media) || contentType != tt.wantMIME || post.Type != tt.wantType {
					t.Fatalf("wrong file or type: %q, %s, %s, %v", data, contentType, post.Type, err)
				}
				post.Url = "https://storage.googleapis.com/example/object"
				return tt.saveError
			}).ServeHTTP(response, request)
			if response.Code != tt.wantStatus || called != (tt.wantMIME != "") {
				t.Fatalf("status %d, saved=%v: %s", response.Code, called, response.Body.String())
			}
			if response.Code == http.StatusOK {
				var post model.Post
				if err := json.Unmarshal(response.Body.Bytes(), &post); err != nil {
					t.Fatal(err)
				}
				if uuid.Parse(post.Id) == nil || post.User != "vincent" || post.Message != "你好，Lesson33" || post.Url == "" {
					t.Fatalf("unexpected saved post: %+v", post)
				}
			}
		})
	}
}

func TestUploadRejectsMismatchedContentAndOversizeBody(t *testing.T) {
	for _, test := range []struct {
		name     string
		contents []byte
		status   int
	}{
		{"HTML disguised as PNG", []byte("<!doctype html><html><script>alert('x')</script></html>"), http.StatusUnsupportedMediaType},
		{"oversized multipart upload", bytes.Repeat([]byte("x"), maxUploadBytes), http.StatusRequestEntityTooLarge},
	} {
		t.Run(test.name, func(t *testing.T) {
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			if err := form.WriteField("message", "test message"); err != nil {
				t.Fatal(err)
			}
			part, err := form.CreateFormFile("media_file", "photo.png")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write(test.contents); err != nil {
				t.Fatal(err)
			}
			if err := form.Close(); err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "/posts", &body)
			request = request.WithContext(context.WithValue(request.Context(), usernameContextKey{}, "testuser"))
			request.Header.Set("Content-Type", form.FormDataContentType())
			response := httptest.NewRecorder()
			uploadHandler(func(context.Context, *model.Post, io.Reader, string, string) error {
				t.Fatal("invalid uploads must not reach media storage")
				return nil
			}).ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status=%d want=%d", response.Code, test.status)
			}
		})
	}
}
