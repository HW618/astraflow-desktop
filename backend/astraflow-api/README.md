# AstraFlow API

Kratos backend scaffold for AstraFlow cloud services. This module is
protobuf-first, exposes HTTP and gRPC transports, generates OpenAPI from proto
annotations, and uses Wire for dependency injection.

## What Is Included

- Kratos HTTP and gRPC server setup.
- Protobuf API definitions and generated Go code.
- OpenAPI generation to `openapi.yaml`.
- Wire-based dependency injection.
- Layered `service`, `biz`, and `data` packages.
- Initial health API contract.

## Project Layout

```text
api/                  Protobuf APIs and generated bindings
cmd/                  Application entrypoints
configs/              Local configuration
internal/server/      HTTP and gRPC server construction
internal/service/     Transport-facing service methods
internal/biz/         Usecases, entities, errors, repository interfaces
internal/data/        Repository implementations
openapi.yaml          Generated OpenAPI document
```

## Development Commands

Install generators:

```bash
make init
```

Regenerate API bindings and OpenAPI:

```bash
make api
```

Regenerate config protobufs:

```bash
make config
```

Run all generation steps, Wire, and module cleanup:

```bash
make all
```

Build:

```bash
make build
```

Test:

```bash
go test ./...
```

## Run Locally

```bash
go run ./cmd/astraflow-api -conf ./configs
```

Default local ports are configured in `configs/config.yaml`:

- HTTP: `0.0.0.0:8000`
- gRPC: `0.0.0.0:9000`

## Docker

```bash
docker build -t astraflow-api .
docker run --rm -p 8000:8000 -p 9000:9000 \
  -v </path/to/configs>:/data/conf \
  astraflow-api
```
