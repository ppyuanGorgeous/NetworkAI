FROM golang:1.27.3-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /networkai .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && addgroup -S app && adduser -S app -G app \
    && mkdir -p /data/media && chown app:app /data/media
WORKDIR /app
COPY --from=builder /networkai /app/networkai
USER app
EXPOSE 8080
CMD ["/app/networkai"]
