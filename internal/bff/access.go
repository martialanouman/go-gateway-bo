package bff

import (
	"context"
	"errors"
	"strings"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// SetPasswordFromAccessLink ne hache qu'après avoir vérifié le jeton : sur une route publique, un
// jeton inventé ne doit pas coûter une place argon2id.
func (a API) SetPasswordFromAccessLink(ctx context.Context, request SetPasswordFromAccessLinkRequestObject,
) (SetPasswordFromAccessLinkResponseObject, error) {
	body := request.Body
	if body == nil || !within(body.Password, 0, 4096) {
		return SetPasswordFromAccessLink400JSONResponse(badRequest()), nil
	}

	digest, ok := store.AccessTokenDigest(body.Token)
	if !ok {
		return SetPasswordFromAccessLink410JSONResponse(linkNoLongerValid()), nil
	}

	valid, err := a.AccessLinks.Valid(ctx, digest)
	if err != nil {
		return nil, err
	}

	if !valid {
		return SetPasswordFromAccessLink410JSONResponse(linkNoLongerValid()), nil
	}

	// La politique après le jeton : son refus annonce que le lien reste valable.
	if missing := auth.CheckPassword(body.Password); len(missing) > 0 {
		return SetPasswordFromAccessLink400JSONResponse(weakPassword(missing)), nil
	}

	var hash string

	err = auth.Hold(ctx, func() (hashErr error) {
		hash, hashErr = auth.Hash(body.Password)

		return hashErr
	})
	if errors.Is(err, auth.ErrOverloaded) {
		return SetPasswordFromAccessLink503JSONResponse(passwordNotSavedOverloaded()), nil
	}

	if err != nil {
		return nil, err
	}

	err = a.AccessLinks.Consume(ctx, digest, hash, a.event(ctx, store.Event{
		Action: actionPasswordSet, TargetType: auditTargetOperator,
	}))
	if errors.Is(err, store.ErrLinkInvalid) {
		return SetPasswordFromAccessLink410JSONResponse(linkNoLongerValid()), nil
	}

	if err != nil {
		return nil, err
	}

	return SetPasswordFromAccessLink204Response{}, nil
}

// linkNoLongerValid est le refus unique : servi, expiré, remplacé ou compte désactivé se lisent de
// même, pour ne rien apprendre à qui détient un vieux lien.
func linkNoLongerValid() Error {
	return Error{Code: "access_link_invalid",
		Message: "Ce lien n'est plus valable : demandez-en un nouveau à un administrateur."}
}

func weakPassword(missing []string) Error {
	return Error{Code: "password_policy", Message: "Le mot de passe n'a pas été enregistré : il lui manque " +
		strings.Join(missing, ", ") + ". Le lien reste valable."}
}

func passwordNotSavedOverloaded() Error {
	return Error{Code: "overloaded", Message: "Le mot de passe n'a pas été enregistré : le serveur vérifie " +
		"déjà autant d'identifiants qu'il peut en tenir. Réessayez dans quelques secondes ; le lien reste " +
		"valable."}
}
