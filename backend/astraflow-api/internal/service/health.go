package service

import (
	"context"

	v1 "astraflow-api/api/astraflow/v1"
	"astraflow-api/internal/biz"

	"google.golang.org/protobuf/types/known/timestamppb"
)

type HealthService struct {
	v1.UnimplementedHealthServiceServer

	uc *biz.HealthUsecase
}

func NewHealthService(uc *biz.HealthUsecase) *HealthService {
	return &HealthService{uc: uc}
}

func (s *HealthService) CheckHealth(ctx context.Context, _ *v1.CheckHealthRequest) (*v1.CheckHealthReply, error) {
	status, err := s.uc.Check(ctx)
	if err != nil {
		return nil, err
	}
	return &v1.CheckHealthReply{
		Status:     status.Status,
		Service:    status.Service,
		Version:    status.Version,
		ServerTime: timestamppb.New(status.ServerTime),
	}, nil
}
