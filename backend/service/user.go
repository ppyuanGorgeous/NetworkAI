package service

import (
	"context"
	"errors"
	"net/http"

	"networkai/backend"
	"networkai/constants"
	"networkai/model"

	"github.com/olivere/elastic/v7"
	"golang.org/x/crypto/bcrypt"
)

func AddUser(ctx context.Context, user model.User) (bool, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
	if err != nil {
		return false, err
	}
	user.Password = string(hash)
	err = backend.ESBackend.SaveToES(ctx, user, constants.USER_INDEX, user.Username)
	var conflict *elastic.Error
	if errors.As(err, &conflict) && conflict.Status == http.StatusConflict {
		return false, nil
	}
	return err == nil, err
}

func CheckUser(ctx context.Context, username, password string) (bool, error) {
	var user model.User
	found, err := backend.ESBackend.ReadDocument(ctx, constants.USER_INDEX, username, &user)
	if err != nil {
		return false, err
	}
	if !found {
		return false, nil
	}
	return bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)) == nil, nil
}
