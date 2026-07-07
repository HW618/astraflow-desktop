package biz

import (
	"context"
	"time"
)

type HealthRepo interface {
	Check(context.Context) error
}

type HealthStatus struct {
	Status     string
	Service    string
	Version    string
	ServerTime time.Time
}

type HealthUsecase struct {
	repo HealthRepo
}

func NewHealthUsecase(repo HealthRepo) *HealthUsecase {
	return &HealthUsecase{repo: repo}
}

func (uc *HealthUsecase) Check(ctx context.Context) (*HealthStatus, error) {
	if err := uc.repo.Check(ctx); err != nil {
		return nil, err
	}
	return &HealthStatus{
		Status:     "ok",
		Service:    "astraflow-api",
		Version:    "dev",
		ServerTime: time.Now().UTC(),
	}, nil
}
