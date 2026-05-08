.PHONY: test

test:
	# npm --prefix frontend install
	npm --prefix frontend run build
	go test -v -tags=integration ./test/e2e/...
