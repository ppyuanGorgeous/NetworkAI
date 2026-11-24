package constants

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const (
	USER_INDEX = "user"
	POST_INDEX = "post"
	ES_URL     = "http://127.0.0.1:9200"
	GCS_BUCKET = ""
)

type ElasticsearchConfig struct {
	URL      string `json:"-" yaml:"address"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// LoadElasticsearchConfig reads the endpoint and credentials from configuration,
// environment variables, or an optional private credentials file.
func LoadElasticsearchConfig(config ElasticsearchConfig) (ElasticsearchConfig, error) {
	if value := os.Getenv("ES_URL"); value != "" {
		config.URL = value
	}
	if value := os.Getenv("ES_USERNAME"); value != "" {
		config.Username = value
	}
	if value := os.Getenv("ES_PASSWORD"); value != "" {
		config.Password = value
	}
	if config.Username == "" || config.Password == "" {
		path := os.Getenv("ES_CREDENTIALS_FILE")
		if path == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return config, fmt.Errorf("find credentials directory: %w", err)
			}
			path = filepath.Join(home, ".config", "networkai", "elasticsearch.json")
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return config, fmt.Errorf("read Elasticsearch credentials: %w", err)
		}
		var saved ElasticsearchConfig
		if err := json.Unmarshal(data, &saved); err != nil {
			return config, fmt.Errorf("invalid Elasticsearch credentials JSON")
		}
		if config.Username == "" {
			config.Username = saved.Username
		}
		if config.Password == "" {
			config.Password = saved.Password
		}
	}
	if config.URL == "" || config.Username == "" || config.Password == "" {
		return config, fmt.Errorf("Elasticsearch URL, username and password are required")
	}
	return config, nil
}
