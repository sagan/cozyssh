package constants

const (
	HEADER_AUTHORIZATION_BEARER_PREFIX = "Bearer "
	HEADER_CONNECTION                  = "Connection"
	// the next is UTF-8 encoded filename (space to %20)
	HEADER_CONTENT_DISPOSITION_PREFIX       = `attachment; filename*=UTF-8''`
	HEADER_SEC_WEBSOCKET_PROTOCOL           = "Sec-WebSocket-Protocol"
	HEADER_X_COZYSSH_FETCH_PREFIX_LOWERCASE = "x-cozyssh-fetch-"
	HEADER_X_COZYSSH_URL                    = "X-Cozyssh-Url"
	HEADER_X_COZYSSH_PREFIX_LOWERCASE       = "x-cozyssh-"
	MIME_BINARY                             = "application/octet-stream"
	MIME_JSON                               = "application/json"
	VAR_TOKEN                               = "token"
	BROWSER_STORAGE_KEY_TOKEN               = "cozy_token"
	APP_NAME                                = "CozySSH"
	LOCAL_NAME                              = "local" // local shell "server name"
	COZYSSH_TOKEN_PREFIX                    = "cozytoken."
	WS_PROTOCOL_QUERY_PREFIX                = "query."    // pass query parameters in ws protocol to prevent logging
	WS_PROTOCOL_IDENTITY_PREFIX             = "identity." // pass identity in ws protocol to prevent logging
	WS_PROTOCOL_DUMMY                       = "dummy"     // used as response sec-websocket-protocol header
	DEFAULT_BUTTON_GROUP                    = "Default"
	DEFAULT_BUTTON_TYPE                     = "send_string"
)
