// Command dashboard sert le tableau de bord Admin : le BFF et, à terme, les assets de la SPA.
package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
)

func main() {
	if err := run(context.Background()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(_ context.Context) error {
	ln, err := net.Listen("tcp", os.Getenv("DASHBOARD_ADDR"))
	if err != nil {
		return err
	}

	return http.Serve(ln, http.NotFoundHandler())
}
