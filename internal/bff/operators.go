package bff

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/martialanouman/go-gateway-bo/internal/auth"
	"github.com/martialanouman/go-gateway-bo/internal/store"
)

// Les routes d'administration. La garde a déjà exigé une session vivante, élevée et porteuse de la
// clé ; ce qui reste ici, ce sont les refus structurels, chacun expliqué.

func (a API) ListOperators(ctx context.Context, _ ListOperatorsRequestObject) (ListOperatorsResponseObject, error) {
	found, err := a.Administration.Operators(ctx)
	if err != nil {
		return nil, err
	}

	listed := make(ListOperators200JSONResponse, 0, len(found))
	for _, view := range found {
		listed = append(listed, operatorDTO(view))
	}

	return listed, nil
}

func (a API) CreateOperator(ctx context.Context, request CreateOperatorRequestObject,
) (CreateOperatorResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	body := request.Body
	if body == nil || !within(strings.TrimSpace(body.Email), 3, 320) ||
		!within(strings.TrimSpace(body.DisplayName), 1, 200) || !within(body.Password, 0, 4096) {
		return CreateOperator400JSONResponse{RequeteInvalideJSONResponse(malformedOperator())}, nil
	}

	if !auth.PasswordLongEnough(body.Password) {
		return CreateOperator400JSONResponse{RequeteInvalideJSONResponse(passwordTooShort())}, nil
	}

	hash, err := auth.Hash(body.Password)
	if err != nil {
		return nil, err
	}

	created, err := a.Administration.CreateOperator(ctx, strings.TrimSpace(body.Email),
		strings.TrimSpace(body.DisplayName), hash, a.event(ctx, store.Event{
			OperatorID: actor, Action: actionOperatorCreate, TargetType: auditTargetOperator,
		}))
	if errors.Is(err, store.ErrEmailTaken) {
		return CreateOperator409JSONResponse(emailTaken()), nil
	}

	if err != nil {
		return nil, err
	}

	return CreateOperator201JSONResponse(operatorDTO(created)), nil
}

func (a API) UpdateOperator(ctx context.Context, request UpdateOperatorRequestObject,
) (UpdateOperatorResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	if request.Body == nil || !request.Body.Status.Valid() {
		return UpdateOperator400JSONResponse{RequeteInvalideJSONResponse(malformedStatus())}, nil
	}

	status := string(request.Body.Status)
	if request.OperatorId == actor && status != store.StatusActive {
		return UpdateOperator409JSONResponse{AutoVerrouillageJSONResponse(cannotDisableSelf())}, nil
	}

	action := actionOperatorEnable
	if status != store.StatusActive {
		action = actionOperatorDisable
	}

	updated, err := a.Administration.SetOperatorStatus(ctx, request.OperatorId, status,
		a.event(ctx, store.Event{OperatorID: actor, Action: action, TargetType: auditTargetOperator}))
	if errors.Is(err, store.ErrOperatorUnknown) {
		return UpdateOperator404JSONResponse{OperateurInconnuJSONResponse(unknownOperator())}, nil
	}

	if err != nil {
		return nil, err
	}

	return UpdateOperator200JSONResponse(operatorDTO(updated)), nil
}

func (a API) SetOperatorRoles(ctx context.Context, request SetOperatorRolesRequestObject,
) (SetOperatorRolesResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	if request.Body == nil || len(request.Body.RoleIds) > 100 {
		return SetOperatorRoles400JSONResponse{RequeteInvalideJSONResponse(malformedRoleSet())}, nil
	}

	updated, err := a.Administration.SetOperatorRoles(ctx, actor, request.OperatorId, request.Body.RoleIds,
		a.event(ctx, store.Event{OperatorID: actor, Action: actionOperatorRolesSet, TargetType: auditTargetOperator}))

	switch {
	case errors.Is(err, store.ErrOperatorUnknown):
		return SetOperatorRoles404JSONResponse{OperateurInconnuJSONResponse(unknownOperator())}, nil
	case errors.Is(err, store.ErrUnknownReference):
		return SetOperatorRoles400JSONResponse{RequeteInvalideJSONResponse(unknownRoleReference())}, nil
	case errors.Is(err, store.ErrSelfLockout):
		return SetOperatorRoles409JSONResponse{AutoVerrouillageJSONResponse(selfLockout())}, nil
	case err != nil:
		return nil, err
	}

	return SetOperatorRoles200JSONResponse(operatorDTO(updated)), nil
}

func (a API) ResetOperatorSecondFactors(ctx context.Context, request ResetOperatorSecondFactorsRequestObject,
) (ResetOperatorSecondFactorsResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	if request.OperatorId == actor {
		return ResetOperatorSecondFactors409JSONResponse{AutoVerrouillageJSONResponse(cannotResetOwnFactor())}, nil
	}

	err = a.Administration.ResetSecondFactors(ctx, request.OperatorId,
		a.event(ctx, store.Event{OperatorID: actor, Action: actionOperatorMFAReset, TargetType: auditTargetOperator}))
	if errors.Is(err, store.ErrOperatorUnknown) {
		return ResetOperatorSecondFactors404JSONResponse{OperateurInconnuJSONResponse(unknownOperator())}, nil
	}

	if err != nil {
		return nil, err
	}

	return ResetOperatorSecondFactors204Response{}, nil
}

func (a API) ListRoles(ctx context.Context, _ ListRolesRequestObject) (ListRolesResponseObject, error) {
	found, err := a.Administration.Roles(ctx)
	if err != nil {
		return nil, err
	}

	listed := make(ListRoles200JSONResponse, 0, len(found))
	for _, view := range found {
		listed = append(listed, roleDTO(view))
	}

	return listed, nil
}

func (a API) CreateRole(ctx context.Context, request CreateRoleRequestObject) (CreateRoleResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	body := request.Body
	if body == nil || !within(strings.TrimSpace(body.Name), 1, 100) ||
		!within(body.Description, 0, 500) || len(body.Permissions) > 100 {
		return CreateRole400JSONResponse{RequeteInvalideJSONResponse(malformedRole())}, nil
	}

	created, err := a.Administration.CreateRole(ctx, strings.TrimSpace(body.Name), body.Description,
		body.Permissions,
		a.event(ctx, store.Event{OperatorID: actor, Action: actionRoleCreate, TargetType: auditTargetRole}))

	switch {
	case errors.Is(err, store.ErrRoleNameTaken):
		return CreateRole409JSONResponse(roleNameTaken()), nil
	case errors.Is(err, store.ErrUnknownReference):
		return CreateRole400JSONResponse{RequeteInvalideJSONResponse(unknownPermission())}, nil
	case err != nil:
		return nil, err
	}

	return CreateRole201JSONResponse(roleDTO(created)), nil
}

func (a API) UpdateRole(ctx context.Context, request UpdateRoleRequestObject) (UpdateRoleResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	body := request.Body
	if body == nil || !within(body.Description, 0, 500) || len(body.Permissions) > 100 {
		return UpdateRole400JSONResponse{RequeteInvalideJSONResponse(malformedRoleUpdate())}, nil
	}

	updated, err := a.Administration.UpdateRole(ctx, actor, request.RoleId, body.Description, body.Permissions,
		a.event(ctx, store.Event{OperatorID: actor, Action: actionRoleUpdate, TargetType: auditTargetRole}))

	switch {
	case errors.Is(err, store.ErrRoleUnknown):
		return UpdateRole404JSONResponse{RoleInconnuJSONResponse(unknownRole())}, nil
	case errors.Is(err, store.ErrDefaultRole):
		return UpdateRole409JSONResponse{RoleIntouchableJSONResponse(defaultRoleIsReadOnly())}, nil
	case errors.Is(err, store.ErrSelfLockout):
		return UpdateRole409JSONResponse{RoleIntouchableJSONResponse(selfLockout())}, nil
	case errors.Is(err, store.ErrUnknownReference):
		return UpdateRole400JSONResponse{RequeteInvalideJSONResponse(unknownPermission())}, nil
	case err != nil:
		return nil, err
	}

	return UpdateRole200JSONResponse(roleDTO(updated)), nil
}

func (a API) DeleteRole(ctx context.Context, request DeleteRoleRequestObject) (DeleteRoleResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}

	err = a.Administration.DeleteRole(ctx, request.RoleId,
		a.event(ctx, store.Event{OperatorID: actor, Action: actionRoleDelete, TargetType: auditTargetRole}))

	var held store.RoleHeldError

	switch {
	case errors.Is(err, store.ErrRoleUnknown):
		return DeleteRole404JSONResponse{RoleInconnuJSONResponse(unknownRole())}, nil
	case errors.Is(err, store.ErrDefaultRole):
		return DeleteRole409JSONResponse{RoleIntouchableJSONResponse(defaultRoleIsReadOnly())}, nil
	case errors.As(err, &held):
		return DeleteRole409JSONResponse{RoleIntouchableJSONResponse(roleHeld(held.Holders))}, nil
	case err != nil:
		return nil, err
	}

	return DeleteRole204Response{}, nil
}

// within compte en caractères, comme `minLength` et `maxLength` du contrat, et non en octets.
func within(value string, minimum, maximum int) bool {
	count := utf8.RuneCountInString(value)

	return count >= minimum && count <= maximum
}

// actorOf rend l'opérateur de la session. La garde l'a déjà exigée vivante : son absence ici est une
// anomalie, pas un refus.
func actorOf(ctx context.Context) (string, error) {
	resolved, alive, err := sessionFrom(ctx)
	if err != nil {
		return "", err
	}

	if !alive {
		return "", errors.New("route d'administration atteinte sans session vivante : la garde n'est pas montée")
	}

	return resolved.OperatorID, nil
}

func operatorDTO(view store.OperatorView) Operator {
	roles := make([]RoleReference, 0, len(view.RoleIDs))
	for i, id := range view.RoleIDs {
		roles = append(roles, RoleReference{Id: id, Name: view.RoleNames[i]})
	}

	return Operator{
		Id:                   view.ID,
		Email:                view.Email,
		DisplayName:          view.DisplayName,
		Status:               OperatorStatus(view.Status),
		Roles:                roles,
		SecondFactorEnrolled: view.SecondFactorEnrolled,
	}
}

func roleDTO(view store.RoleView) Role {
	return Role{
		Id:          view.ID,
		Name:        view.Name,
		Description: view.Description,
		IsDefault:   view.IsDefault,
		Permissions: view.Permissions,
		Holders:     view.Holders,
	}
}

func malformedOperator() Error {
	return Error{Code: "bad_request", Message: "L'opérateur n'a pas été enregistré : l'adresse (de 3 à " +
		"320 caractères) et le nom affiché (200 au plus) sont obligatoires, et le mot de passe compte " +
		"au plus 4096 caractères."}
}

func malformedStatus() Error {
	return Error{Code: "bad_request", Message: "L'opérateur n'a pas été modifié : son statut doit valoir " +
		"« active » ou « disabled »."}
}

func malformedRoleSet() Error {
	return Error{Code: "bad_request", Message: "Les rôles n'ont pas été changés : la requête désigne au " +
		"plus 100 rôles, sous la forme attendue."}
}

func malformedRole() Error {
	return Error{Code: "bad_request", Message: "Le rôle n'a pas été enregistré : son nom (100 caractères au " +
		"plus) est obligatoire, la description compte au plus 500 caractères et la liste au plus 100 " +
		"permissions."}
}

func malformedRoleUpdate() Error {
	return Error{Code: "bad_request", Message: "Le rôle n'a pas été modifié : la description compte au plus " +
		"500 caractères et la liste au plus 100 permissions."}
}

func passwordTooShort() Error {
	return Error{Code: "password_too_short", Message: "L'opérateur n'a pas été créé : son mot de passe doit " +
		"compter au moins 12 caractères. La longueur est la seule règle ; aucune composition n'est exigée."}
}

func emailTaken() Error {
	return Error{Code: "email_taken", Message: "L'opérateur n'a pas été créé : un compte porte déjà cette " +
		"adresse, sans tenir compte des majuscules. Réactivez-le s'il est désactivé."}
}

func unknownOperator() Error {
	return Error{Code: "not_found", Message: "Aucun opérateur ne porte cet identifiant. Rechargez la liste."}
}

func unknownRole() Error {
	return Error{Code: "not_found", Message: "Aucun rôle ne porte cet identifiant. Rechargez la liste."}
}

func unknownRoleReference() Error {
	return Error{Code: "bad_request", Message: "Les rôles n'ont pas été changés : l'un des rôles désignés " +
		"n'existe plus. Rechargez la liste des rôles."}
}

func unknownPermission() Error {
	return Error{Code: "bad_request", Message: "Le rôle n'a pas été enregistré : une des permissions " +
		"désignées n'appartient pas au catalogue."}
}

func roleNameTaken() Error {
	return Error{Code: "role_name_taken", Message: "Le rôle n'a pas été créé : un rôle porte déjà ce nom, " +
		"y compris parmi les neuf rôles par défaut. Choisissez-en un autre."}
}

func cannotDisableSelf() Error {
	return Error{Code: "self_lockout", Message: "Votre compte reste actif : vous ne pouvez pas vous " +
		"désactiver vous-même. Un autre administrateur détenant « operators:manage » peut le faire."}
}

func cannotResetOwnFactor() Error {
	return Error{Code: "self_lockout", Message: "Votre second facteur reste en place : la réinitialisation " +
		"vise un autre opérateur. Pour remplacer le vôtre, présentez à l'enrôlement un code de " +
		"l'application actuelle ou un code de récupération ; aucun écran ne le permet encore."}
}

func selfLockout() Error {
	return Error{Code: "self_lockout", Message: "Rien n'a été changé : ce geste vous retirerait « " +
		"operators:manage » ou « roles:manage ». Seul un autre détenteur de ces clés peut vous les " +
		"retirer ; s'il n'en existe aucun, attribuez-les d'abord à un second opérateur."}
}

func defaultRoleIsReadOnly() Error {
	return Error{Code: "role_is_default", Message: "Ce rôle par défaut reste tel quel : il est livré avec " +
		"le produit et réécrit à chaque déploiement, une modification serait défaite. Composez un rôle " +
		"personnalisé à partir de ses permissions."}
}

func roleHeld(holders []string) Error {
	return Error{Code: "role_held", Message: "Le rôle n'a pas été supprimé : il est détenu par " +
		strings.Join(holders, ", ") + ". Retirez-le d'abord à ces opérateurs."}
}
