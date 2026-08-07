# Makefile for the g4f.dev cake-baker Go program.
#
# Build a single binary for the current platform:
#   make build
#
# Cross-compile binaries for all supported platforms:
#   make all
#
# Clean build artifacts:
#   make clean
#
# Run directly (no binary):
#   make run
#
# Build for a specific platform:
#   make GOOS=linux GOARCH=arm64 build

BINARY      := cake-baker
PKG_DIR     := .
DIST_DIR    := dist
VERSION     := $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
LDFLAGS     := -s -w -X main.version=$(VERSION)
GOFLAGS     := -trimpath
BUILD_ENV   := CGO_ENABLED=0

# Default platform targets for `make all`.
TARGETS := \
	linux/amd64 \
	linux/arm64 \
	darwin/amd64 \
	darwin/arm64 \
	windows/amd64 \
	windows/arm64 \
	freebsd/amd64

.PHONY: all build run clean vet fmt test help $(TARGETS)

# ---------------------------------------------------------------------------
# Single-platform build (honors GOOS/GOARCH env or args)
# ---------------------------------------------------------------------------
build:
	@mkdir -p $(DIST_DIR)
	$(BUILD_ENV) go build $(GOFLAGS) -ldflags "$(LDFLAGS)" \
		-o $(DIST_DIR)/$(BINARY)-$(or $(GOOS),$(shell go env GOOS))-$(or $(GOARCH),$(shell go env GOARCH))$(if $(filter windows,$(or $(GOOS),$(shell go env GOOS))),.exe,) \
		$(PKG_DIR)

# ---------------------------------------------------------------------------
# Cross-compile all targets
# ---------------------------------------------------------------------------
all: $(TARGETS)

# Pattern rule: each target is "GOOS/GOARCH".
linux/amd64 darwin/arm64 windows/amd64 freebsd/amd64 linux/arm64 darwin/amd64 windows/arm64:
	@mkdir -p $(DIST_DIR)
	@target="$@"; \
	goos="$${target%/*}"; \
	goarch="$${target#*/}"; \
	ext=""; \
	if [ "$$goos" = "windows" ]; then ext=".exe"; fi; \
	out="$(DIST_DIR)/$(BINARY)-$$goos-$$goarch$$ext"; \
	echo "==> building $$out"; \
	CGO_ENABLED=0 GOOS=$$goos GOARCH=$$goarch \
		go build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o "$$out" $(PKG_DIR) || exit 1; \
		( command -v sha256sum >/dev/null && sha256sum "$$out" > "$$out.sha256" ) || true

# ---------------------------------------------------------------------------
# Convenience targets
# ---------------------------------------------------------------------------
run:
	go run . $(ARGS)

vet:
	go vet ./...

fmt:
	gofmt -s -w *.go

test:
	go test ./...

clean:
	rm -rf $(DIST_DIR)

help:
	@echo "cake-baker Makefile"
	@echo ""
	@echo "Targets:"
	@echo "  make build       Build for current platform"
	@echo "  make all         Cross-compile for all platforms into dist/"
	@echo "  make run ARGS=\"-workers 8\"   Run without building a binary"
	@echo "  make vet         Run go vet"
	@echo "  make fmt         Format source files"
	@echo "  make test        Run tests"
	@echo "  make clean       Remove dist/"
	@echo ""
	@echo "Override GOOS/GOARCH for a single build:"
	@echo "  make build GOOS=linux GOARCH=arm64"
	@echo ""
	@echo "Targets built by 'make all':"
	@for t in $(TARGETS); do echo "  $$t"; done