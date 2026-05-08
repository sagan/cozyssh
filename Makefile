.PHONY: test

test:
	npm --prefix frontend run build
	go test -v -tags=integration ./test/e2e/...
