package main

import (
	"context"
	"fmt"
	"os"

	"cozyssh"
)

func main() {
	if err := cozyssh.Run(context.Background(), os.Args[1:], nil); err != nil {
		if err != context.Canceled {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
	}
}
