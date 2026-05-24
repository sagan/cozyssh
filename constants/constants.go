package constants

const (
	HEADER_AUTHORIZATION_BEARER_PREFIX = "Bearer "
	HEADER_CONNECTION                  = "Connection"
	// the next is UTF-8 encoded filename (space to %20)
	HEADER_CONTENT_DISPOSITION_PREFIX = `attachment; filename*=UTF-8''`
	HEADER_SEC_WEBSOCKET_PROTOCOL     = "Sec-WebSocket-Protocol"
	MIME_BINARY                       = "application/octet-stream"
	MIME_JSON                         = "application/json"
	VAR_TOKEN                         = "token"
	BROWSER_STORAGE_KEY_TOKEN         = "cozy_token"
)
