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
	IDENTITY_PREFIX                         = "$identity:"
	DEFAULT_PASSWORD_LENGTH                 = 32 // [a-zA-Z0-9]{length}, each char is 5.9 bits. 128 bits requires >= 22
	ID_DELETE_PREFIX                        = "__$$delete$$__"
	CONFIG_FILE                             = "config.json"
	SYNC_METADATA_FILE                      = "sync-metadata.json"
	APP_CONFIG_FILE                         = "app-config.json"
	WEBVIEW2_DATA_DIR                       = "webview2_data"
	INITIAL_PASSWORD_FILE                   = "initial_password.txt"
	APP_DEFAULT_WIDTH                       = 1024
	APP_DEFAULT_HEIGHT                      = 768
	APP_MIN_WIDTH                           = 400
	APP_MIN_HEIGHT                          = 300
	TAG_GROUP_PREFIX                        = "g-"
	TAG_ORDER_PREFIX                        = "o-"
	TAG_FAV                                 = "fav"
	KEYRING_APP_PASSWORD_USER_PREFIX        = "app-password."
)
