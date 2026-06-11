.PHONY: test

test:
	# npm --prefix frontend install
	npm --prefix frontend run build
	go test -v -tags=integration ./test/e2e/...

# Windows only
build-app:
#	npm --prefix frontend run build
	go build -trimpath -ldflags "-H=windowsgui" -o cozyssh-app.exe ./cmd/cozyssh_windows_app
