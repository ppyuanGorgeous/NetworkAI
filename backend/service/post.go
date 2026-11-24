package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"networkai/backend"
	"networkai/constants"
	"networkai/model"

	"github.com/olivere/elastic/v7"
)

func SavePost(ctx context.Context, post *model.Post, file io.Reader, extension, contentType string) error {
	url, err := backend.SaveMedia(ctx, file, post.Id+extension, contentType)
	if err != nil {
		return err
	}
	post.Url = url
	if err := backend.ESBackend.SaveToES(ctx, post, constants.POST_INDEX, post.Id); err != nil {
		cleanupErr := backend.DeleteMedia(context.WithoutCancel(ctx), url)
		return fmt.Errorf("index post %s: %w", post.Id, errors.Join(err, cleanupErr))
	}
	return nil
}

func SearchPostsByUser(user string) ([]model.Post, error) {
	query := elastic.NewTermQuery("user", user)
	result, err := backend.ESBackend.ReadFromES(query, constants.POST_INDEX)
	if err != nil {
		return nil, err
	}
	return getPostFromSearchResult(result)
}

func DeletePost(ctx context.Context, id, username string) (bool, error) {
	var post model.Post
	found, err := backend.ESBackend.ReadDocument(ctx, constants.POST_INDEX, id, &post)
	if err != nil || !found || post.User != username {
		return false, err
	}
	query := elastic.NewBoolQuery().Filter(elastic.NewTermQuery("id", id), elastic.NewTermQuery("user", username))
	deleted, err := backend.ESBackend.DeleteFromES(ctx, constants.POST_INDEX, query)
	if err != nil || !deleted {
		return deleted, err
	}
	return true, backend.DeleteMedia(context.WithoutCancel(ctx), post.Url)
}

func SearchPostsByKeywords(keywords string) ([]model.Post, error) {
	query := elastic.NewMatchQuery("message", keywords).Operator("AND")
	if keywords == "" {
		query.ZeroTermsQuery("all")
	}
	result, err := backend.ESBackend.ReadFromES(query, constants.POST_INDEX)
	if err != nil {
		return nil, err
	}
	return getPostFromSearchResult(result)
}

func getPostFromSearchResult(result *elastic.SearchResult) ([]model.Post, error) {
	posts := make([]model.Post, 0)
	if result == nil || result.Hits == nil {
		return posts, nil
	}
	for _, hit := range result.Hits.Hits {
		var post model.Post
		if err := json.Unmarshal(hit.Source, &post); err != nil {
			return nil, fmt.Errorf("decode post %s: %w", hit.Id, err)
		}
		posts = append(posts, post)
	}
	return posts, nil
}
