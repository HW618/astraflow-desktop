package data

import (
	"context"

	"astraflow-api/internal/biz"
)

type healthRepo struct {
	data *Data
}

func NewHealthRepo(data *Data) biz.HealthRepo {
	return &healthRepo{data: data}
}

func (r *healthRepo) Check(ctx context.Context) error {
	return nil
}
