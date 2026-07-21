// Use system keyring to store app password and use it automatically.

package keyring

import (
	"cozyssh/constants"

	keyring "github.com/zalando/go-keyring"
)

func GetAppPassword(instance string) (string, error) {
	return keyring.Get(constants.APP_NAME, constants.KEYRING_APP_PASSWORD_USER_PREFIX+instance)
}

func SetAppPassword(instance, password string) (err error) {
	if password != "" {
		return keyring.Set(constants.APP_NAME, constants.KEYRING_APP_PASSWORD_USER_PREFIX+instance, password)
	} else {
		return keyring.Delete(constants.APP_NAME, constants.KEYRING_APP_PASSWORD_USER_PREFIX+instance)
	}
}
