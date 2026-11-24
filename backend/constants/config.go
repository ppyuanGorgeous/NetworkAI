package constants

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/oauth2/google"
	"gopkg.in/yaml.v3"
)

type ApplicationConfig struct {
	Elasticsearch ElasticsearchConfig     `yaml:"elasticsearch"`
	GCS           struct{ Bucket string } `yaml:"gcs"`
	Token         struct{ Secret string } `yaml:"token"`
	Media         MediaConfig             `yaml:"media"`
}

type MediaConfig struct {
	Storage       string `yaml:"storage"`
	LocalDir      string `yaml:"local_dir"`
	PublicBaseURL string `yaml:"public_base_url"`
}

func LoadApplicationConfig() (ApplicationConfig, error) {
	var config ApplicationConfig
	config.Elasticsearch.URL = ES_URL
	config.GCS.Bucket = GCS_BUCKET
	config.Media = MediaConfig{Storage: "gcs", LocalDir: "media", PublicBaseURL: "/media"}
	path := os.Getenv("NETWORKAI_CONFIG_FILE")
	explicitPath := path != ""
	secret := os.Getenv("NETWORKAI_CONFIG_SECRET")
	if path == "" && os.Getenv("MEDIA_STORAGE") != "local" {
		path = "conf/deploy.yml"
		if home, err := os.UserHomeDir(); err == nil && secret == "" {
			privatePath := filepath.Join(home, ".config", "networkai", "lesson35.yml")
			if _, err := os.Stat(privatePath); !os.IsNotExist(err) {
				path = privatePath
			}
		}
	}
	if path != "" {
		data, err := os.ReadFile(path)
		if err != nil && (explicitPath || !os.IsNotExist(err)) {
			return config, fmt.Errorf("read application config: %w", err)
		}
		if err == nil {
			if err := yaml.Unmarshal(data, &config); err != nil {
				return config, fmt.Errorf("invalid application config YAML")
			}
		}
	}
	if secret != "" {
		data, err := readConfigSecret(secret)
		if err != nil {
			return config, err
		}
		if err := yaml.Unmarshal(data, &config); err != nil {
			return config, fmt.Errorf("invalid application secret YAML")
		}
	}
	if bucket := os.Getenv("GCS_BUCKET"); bucket != "" {
		config.GCS.Bucket = bucket
	}
	if key := os.Getenv("JWT_SECRET"); key != "" {
		config.Token.Secret = key
	}
	if storage := os.Getenv("MEDIA_STORAGE"); storage != "" {
		config.Media.Storage = storage
	}
	if directory := os.Getenv("MEDIA_LOCAL_DIR"); directory != "" {
		config.Media.LocalDir = directory
	}
	if baseURL := os.Getenv("MEDIA_PUBLIC_BASE_URL"); baseURL != "" {
		config.Media.PublicBaseURL = baseURL
	}
	if config.Media.Storage != "local" && config.Media.Storage != "gcs" {
		return config, fmt.Errorf("MEDIA_STORAGE must be local or gcs")
	}
	if config.Token.Secret == "" {
		return config, fmt.Errorf("JWT signing key is missing: set NETWORKAI_CONFIG_FILE to your private config or set JWT_SECRET")
	}
	if len(config.Token.Secret) < 32 {
		return config, fmt.Errorf("JWT signing key must be at least 32 bytes")
	}
	var err error
	config.Elasticsearch, err = LoadElasticsearchConfig(config.Elasticsearch)
	return config, err
}

func readConfigSecret(name string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	client, err := google.DefaultClient(ctx, "https://www.googleapis.com/auth/cloud-platform")
	if err != nil {
		return nil, fmt.Errorf("authenticate to Secret Manager: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://secretmanager.googleapis.com/v1/"+name+":access", nil)
	if err != nil {
		return nil, fmt.Errorf("invalid Secret Manager resource name")
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("read Secret Manager config: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Secret Manager returned HTTP %d", response.StatusCode)
	}
	var result struct {
		Payload struct{ Data []byte }
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 128<<10)).Decode(&result); err != nil || len(result.Payload.Data) == 0 {
		return nil, fmt.Errorf("invalid Secret Manager response")
	}
	return result.Payload.Data, nil
}
