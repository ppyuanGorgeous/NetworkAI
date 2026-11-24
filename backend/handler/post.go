package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"networkai/model"
	"networkai/service"

	"github.com/gorilla/mux"
	"github.com/pborman/uuid"
)

const maxUploadBytes = 32 << 20

var mediaTypes = map[string]string{
	".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".gif": "image/gif", ".png": "image/png",
	".webp": "image/webp", ".webm": "video/webm",
	".mov": "video/quicktime", ".mp4": "video/mp4", ".avi": "video/x-msvideo",
	".flv": "video/x-flv", ".wmv": "video/x-ms-wmv",
}

type savePostFunc func(context.Context, *model.Post, io.Reader, string, string) error

func uploadHandler(savePost savePostFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		username, _ := r.Context().Value(usernameContextKey{}).(string)
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "multipart/form-data" {
			http.Error(w, "Expected multipart/form-data", http.StatusUnsupportedMediaType)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				http.Error(w, "Upload exceeds 32 MiB", http.StatusRequestEntityTooLarge)
			} else {
				http.Error(w, "Invalid multipart form", http.StatusBadRequest)
			}
			return
		}
		defer r.MultipartForm.RemoveAll()

		file, header, err := r.FormFile("media_file")
		if err != nil || header.Size == 0 {
			if file != nil {
				file.Close()
			}
			http.Error(w, "Media file is not available", http.StatusBadRequest)
			return
		}
		defer file.Close()
		extension := strings.ToLower(filepath.Ext(header.Filename))
		contentType, ok := mediaTypes[extension]
		if !ok {
			http.Error(w, "Unsupported media file type", http.StatusUnsupportedMediaType)
			return
		}
		prefix := make([]byte, 512)
		n, readErr := io.ReadFull(file, prefix)
		if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
			http.Error(w, "Unable to read media file", http.StatusBadRequest)
			return
		}
		if !mediaContentMatches(extension, prefix[:n], contentType) {
			http.Error(w, "Media content does not match its file type", http.StatusUnsupportedMediaType)
			return
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			http.Error(w, "Unable to read media file", http.StatusBadRequest)
			return
		}
		post := model.Post{
			Id:      uuid.New(),
			User:    username,
			Message: r.PostFormValue("message"),
			Type:    strings.SplitN(contentType, "/", 2)[0],
		}
		if strings.TrimSpace(post.Message) == "" {
			http.Error(w, "Message is required", http.StatusBadRequest)
			return
		}
		if err := savePost(r.Context(), &post, file, extension, contentType); err != nil {
			fmt.Printf("Failed to save post: %v\n", err)
			http.Error(w, "Failed to save post to backend", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(post)
	}
}

func mediaContentMatches(extension string, prefix []byte, expected string) bool {
	if http.DetectContentType(prefix) == expected {
		return true
	}
	// Some supported video formats are not recognized by net/http's sniffer.
	switch extension {
	case ".mov":
		return len(prefix) >= 12 && ((string(prefix[4:8]) == "ftyp" && string(prefix[8:12]) == "qt  ") ||
			string(prefix[4:8]) == "moov" || string(prefix[4:8]) == "mdat" || string(prefix[4:8]) == "wide")
	case ".flv":
		return bytes.HasPrefix(prefix, []byte("FLV"))
	case ".avi":
		return len(prefix) >= 12 && string(prefix[:4]) == "RIFF" && string(prefix[8:12]) == "AVI "
	case ".wmv":
		return bytes.HasPrefix(prefix, []byte{0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c})
	}
	return false
}

func deleteHandler(w http.ResponseWriter, r *http.Request) {
	username, _ := r.Context().Value(usernameContextKey{}).(string)
	deleted, err := service.DeletePost(r.Context(), mux.Vars(r)["id"], username)
	if err != nil {
		fmt.Printf("Failed to delete post: %v\n", err)
		http.Error(w, "Failed to delete post", http.StatusInternalServerError)
		return
	}
	if !deleted {
		http.NotFound(w, r)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func searchHandler(w http.ResponseWriter, r *http.Request) {
	fmt.Println("Received one request for search")
	user := r.URL.Query().Get("user")
	keywords := r.URL.Query().Get("keywords")
	var posts []model.Post
	var err error
	if user != "" {
		posts, err = service.SearchPostsByUser(user)
	} else {
		posts, err = service.SearchPostsByKeywords(keywords)
	}
	if err != nil {
		http.Error(w, "Failed to read post from backend", http.StatusInternalServerError)
		fmt.Printf("Failed to read post from backend: %v\n", err)
		return
	}
	data, err := json.Marshal(posts)
	if err != nil {
		http.Error(w, "Failed to parse posts into JSON format", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}
