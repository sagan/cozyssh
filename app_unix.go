//go:build !windows

package cozyssh

import (
	"bufio"
	"os"
)

func readLineRaw() (string, error) {
	reader := bufio.NewReader(os.Stdin)
	return reader.ReadString('\n')
}
