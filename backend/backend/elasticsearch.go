package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"networkai/constants"

	"github.com/olivere/elastic/v7"
)

var ESBackend *ElasticsearchBackend

type ElasticsearchBackend struct {
	client *elastic.Client
}

const postMapping = `{"mappings":{"properties":{
	"id":{"type":"keyword"},
	"user":{"type":"keyword"},
	"message":{"type":"text"},
	"url":{"type":"keyword","index":false},
	"type":{"type":"keyword","index":false}
}}}`

const userMapping = `{"mappings":{"properties":{
	"username":{"type":"keyword"},
	"password":{"type":"keyword"},
	"age":{"type":"long","index":false},
	"gender":{"type":"keyword","index":false}
}}}`

func InitElasticsearchBackend(config constants.ElasticsearchConfig) error {
	client, err := elastic.NewClient(
		elastic.SetURL(config.URL),
		elastic.SetBasicAuth(config.Username, config.Password),
		// Keep the configured address usable through a local SSH tunnel as well.
		elastic.SetSniff(false),
	)
	if err != nil {
		return fmt.Errorf("connect to Elasticsearch: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for _, index := range []struct{ name, mapping string }{
		{constants.POST_INDEX, postMapping},
		{constants.USER_INDEX, userMapping},
	} {
		exists, err := client.IndexExists(index.name).Do(ctx)
		if err != nil {
			client.Stop()
			return fmt.Errorf("check %s index: %w", index.name, err)
		}
		if !exists {
			if _, err := client.CreateIndex(index.name).BodyString(index.mapping).Do(ctx); err != nil {
				client.Stop()
				return fmt.Errorf("create %s index: %w", index.name, err)
			}
		}
	}
	ESBackend = &ElasticsearchBackend{client: client}
	fmt.Println("Indexes are created.")
	return nil
}

func (backend *ElasticsearchBackend) ReadFromES(query elastic.Query, index string) (*elastic.SearchResult, error) {
	if backend == nil || backend.client == nil {
		return nil, fmt.Errorf("Elasticsearch backend is not initialized")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return backend.client.Search().Index(index).Query(query).Pretty(true).Do(ctx)
}

func (backend *ElasticsearchBackend) SaveToES(ctx context.Context, data any, index, id string) error {
	if backend == nil || backend.client == nil {
		return fmt.Errorf("Elasticsearch backend is not initialized")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	_, err := backend.client.Index().Index(index).Id(id).OpType("create").BodyJson(data).Refresh("wait_for").Do(ctx)
	return err
}

func (backend *ElasticsearchBackend) ReadDocument(ctx context.Context, index, id string, target any) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	result, err := backend.client.Get().Index(index).Id(id).Do(ctx)
	if elastic.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !result.Found {
		return false, nil
	}
	return true, json.Unmarshal(result.Source, target)
}

func (backend *ElasticsearchBackend) DeleteFromES(ctx context.Context, index string, query elastic.Query) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	result, err := backend.client.DeleteByQuery(index).Query(query).Refresh("true").Do(ctx)
	if err != nil {
		return false, err
	}
	if result.TimedOut || len(result.Failures) != 0 {
		return false, fmt.Errorf("Elasticsearch could not complete deletion")
	}
	return result.Deleted > 0, nil
}
