import { browserSupportsWebAuthn } from '@simplewebauthn/browser'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { TotpEnrollment } from '~/components/totp-enrollment'
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Skeleton,
} from '~/components/ui'
import { blockedBy, orRefusal, Refusal } from '~/lib/administration'
import { api, type Me, meQueryOptions } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import { TotpEnrollmentRequest } from '~/lib/contract.gen'
import { formResolver } from '~/lib/form'
import { passkeyNaming, registerPasskey } from '~/lib/passkey'

type Enrollment = components['schemas']['TotpEnrollment']
type EnrollmentBody = components['schemas']['TotpEnrollmentRequest']
type Passkey = components['schemas']['PasskeySummary']

export const Route = createFileRoute('/_shell/account')({ component: AccountScreen })

const passkeysQueryKey = ['auth', 'passkeys'] as const

const LAST_FACTOR =
  'C’est le dernier second facteur du compte : le retirer en fermerait l’accès. Ajouter une application ou une autre clé d’abord.'

const NO_PASSKEY_PLATFORM =
  'Ce navigateur n’expose pas les clés d’accès : l’enregistrement ne peut pas s’ouvrir ici.'

const INTRO = {
  confirm:
    'Les facteurs en place restent seuls en vigueur tant que la nouvelle application n’est pas confirmée : scannez ce QR code, puis saisissez le code qu’elle affiche.',
  codes:
    'L’application d’authentification est confirmée, et les codes de récupération précédents ne valent plus. Voici les dix nouveaux — ils ne seront plus jamais affichés.',
} as const

function useInvalidateFactors() {
  const queryClient = useQueryClient()

  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: meQueryOptions.queryKey }),
      queryClient.invalidateQueries({ queryKey: passkeysQueryKey }),
    ])
}

function AccountScreen() {
  const { data: me } = useQuery(meQueryOptions)
  const invalidateFactors = useInvalidateFactors()
  const [proving, setProving] = useState(false)
  const title = useRef<HTMLHeadingElement>(null)

  const enroll = useMutation({
    gcTime: 0,
    mutationFn: (body: EnrollmentBody) =>
      orRefusal(
        api.POST('/auth/mfa/totp/enroll', { body }),
        'L’application d’authentification n’a pas été enrôlée',
      ),
  })

  async function confirm(code: string) {
    await orRefusal(
      api.POST('/auth/mfa/totp/confirm', { body: { code } }),
      'L’application d’authentification n’a pas été confirmée',
    )
    await invalidateFactors()
  }

  function backToInventory() {
    enroll.reset()
    setProving(false)
    // La vue qui portait le focus disparaît : sans ceci, il tombe sur `body`.
    title.current?.focus()
  }

  if (me === undefined) return null
  const factors = me.secondFactors

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title" ref={title} tabIndex={-1}>
          Mon compte
        </h1>
      </header>

      {enroll.data !== undefined ? (
        <TotpFlow
          confirm={confirm}
          enrollment={enroll.data}
          onCancel={backToInventory}
          onDone={backToInventory}
        />
      ) : proving ? (
        <Panel title="Application d’authentification">
          <ReplacementProof
            error={enroll.error}
            loading={enroll.isPending}
            onCancel={backToInventory}
            onProof={(body) => enroll.mutate(body)}
          />
        </Panel>
      ) : (
        <>
          <Panel title="Application d’authentification">
            <Refusal error={enroll.error} />
            <p>{factors.totp ? 'Active' : 'Absente'}</p>
            <Button
              loading={enroll.isPending}
              onClick={() => (factors.totp ? setProving(true) : enroll.mutate({}))}
            >
              {factors.totp ? 'Remplacer' : 'Ajouter'}
            </Button>
          </Panel>

          <Panel title="Codes de récupération">
            <p>
              {factors.recoveryCodesRemaining === 0
                ? 'Aucun'
                : `${factors.recoveryCodesRemaining} restants`}
            </p>
          </Panel>

          <Passkeys factors={factors} />
        </>
      )}
    </div>
  )
}

function Panel({
  title,
  focusOnMount = false,
  children,
}: {
  readonly title: string
  readonly focusOnMount?: boolean
  readonly children: ReactNode
}) {
  const titleId = useId()
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (focusOnMount) heading.current?.focus()
  }, [focusOnMount])

  return (
    <section aria-labelledby={titleId} className="account__panel">
      <h2
        className="auth__subtitle"
        id={titleId}
        ref={heading}
        tabIndex={focusOnMount ? -1 : undefined}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

function TotpFlow({
  enrollment,
  confirm,
  onCancel,
  onDone,
}: {
  readonly enrollment: Enrollment
  readonly confirm: (code: string) => Promise<void>
  readonly onCancel: () => void
  readonly onDone: () => void
}) {
  return (
    <TotpEnrollment
      confirm={confirm}
      enrollment={enrollment}
      frame={(phase, content) => (
        <Panel focusOnMount title="Nouvelle application d’authentification">
          <p className="auth__intro">{INTRO[phase]}</p>
          {content}
          {phase === 'confirm' ? <Button onClick={onCancel}>Annuler</Button> : null}
        </Panel>
      )}
      onAcknowledged={onDone}
    />
  )
}

const proofForm = z.object({
  method: z.enum(['totp', 'recovery_code']),
  code: z
    .string()
    .trim()
    .min(1, 'Saisissez un code du facteur en place.')
    .pipe(TotpEnrollmentRequest.shape.code.unwrap()),
})

function ReplacementProof({
  error,
  loading,
  onProof,
  onCancel,
}: {
  readonly error: Error | null
  readonly loading: boolean
  readonly onProof: (body: EnrollmentBody) => void
  readonly onCancel: () => void
}) {
  const form = useForm({
    resolver: formResolver(proofForm),
    defaultValues: { method: 'totp' as const, code: '' },
  })

  return (
    <form className="form" noValidate onSubmit={form.handleSubmit((values) => onProof(values))}>
      <p>
        Le remplacement exige un code du facteur en place : l’application actuelle, ou un code de
        récupération si l’appareil est perdu.
      </p>
      <Refusal error={error} />
      <fieldset className="role-choice">
        <legend>Preuve</legend>
        <label className="role-choice__option">
          <input type="radio" value="totp" {...form.register('method')} /> Application
        </label>
        <label className="role-choice__option">
          <input type="radio" value="recovery_code" {...form.register('method')} /> Code de
          récupération
        </label>
      </fieldset>
      <Field error={form.formState.errors.code?.message} label="Code">
        <Input
          autoComplete="one-time-code"
          autoFocus
          maxLength={64}
          mono
          required
          {...form.register('code')}
        />
      </Field>
      <div className="row-actions">
        <Button loading={loading} type="submit" variant="primary">
          Continuer
        </Button>
        <Button onClick={onCancel}>Annuler</Button>
      </div>
    </form>
  )
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })

function Passkeys({ factors }: { readonly factors: Me['secondFactors'] }) {
  const invalidateFactors = useInvalidateFactors()
  const [adding, setAdding] = useState(false)
  const passkeys = useQuery({
    queryKey: passkeysQueryKey,
    queryFn: () =>
      orRefusal(api.GET('/auth/mfa/webauthn/passkeys'), 'Les clés d’accès n’ont pas pu être lues'),
    retry: false,
  })
  const remove = useMutation({
    mutationFn: (passkey: Passkey) =>
      orRefusal(
        api.DELETE('/auth/mfa/webauthn/passkeys/{passkeyId}', {
          params: { path: { passkeyId: passkey.id } },
        }),
        'La clé d’accès n’a pas été retirée',
      ),
    onSuccess: invalidateFactors,
  })
  const lastFactor = factors.passkeys === 1 && !factors.totp

  return (
    <Panel title="Clés d’accès">
      {adding ? (
        <PasskeyNaming
          onCancel={() => setAdding(false)}
          onRegistered={async () => {
            await invalidateFactors()
            setAdding(false)
          }}
        />
      ) : (
        <Button
          {...blockedBy(browserSupportsWebAuthn() ? undefined : NO_PASSKEY_PLATFORM)}
          onClick={() => setAdding(true)}
        >
          Ajouter
        </Button>
      )}

      <Refusal error={remove.error} />
      {passkeys.isPending ? (
        <LoadingState label="Chargement des clés d’accès…">
          <Skeleton height={38} />
        </LoadingState>
      ) : passkeys.isError ? (
        <ErrorState
          description={passkeys.error.message}
          onRetry={() => void passkeys.refetch()}
          title="Les clés d’accès n’ont pas pu être chargées"
          titleAs="h3"
        />
      ) : passkeys.data.length === 0 ? (
        <EmptyState
          description="« Ajouter » en enregistre une depuis cet appareil."
          title="Aucune clé d’accès sur ce compte"
          titleAs="h3"
        />
      ) : (
        <DataTable
          caption="Clés d’accès du compte"
          columns={[
            { key: 'name', header: 'Nom', cell: (passkey) => passkey.name },
            {
              key: 'createdAt',
              header: 'Ajoutée le',
              cell: (passkey) => dateFormat.format(new Date(passkey.createdAt)),
            },
            {
              key: 'actions',
              header: 'Actions',
              cell: (passkey) => (
                <Button
                  {...blockedBy(lastFactor ? LAST_FACTOR : undefined)}
                  loading={remove.isPending && remove.variables?.id === passkey.id}
                  onClick={() => remove.mutate(passkey)}
                  size="sm"
                  variant="danger"
                >
                  Retirer
                </Button>
              ),
            },
          ]}
          rowKey={(passkey) => passkey.id}
          rows={passkeys.data}
        />
      )}
    </Panel>
  )
}

function PasskeyNaming({
  onRegistered,
  onCancel,
}: {
  readonly onRegistered: () => Promise<void>
  readonly onCancel: () => void
}) {
  const form = useForm({ resolver: formResolver(passkeyNaming), defaultValues: { name: '' } })
  const register = useMutation({
    mutationFn: ({ name }: { name: string }) => registerPasskey(name),
    onSuccess: onRegistered,
  })

  return (
    <form
      className="form"
      noValidate
      onSubmit={form.handleSubmit((values) => register.mutate(values))}
    >
      <Refusal error={register.error} />
      <Field error={form.formState.errors.name?.message} label="Nom de la clé">
        <Input autoComplete="off" autoFocus maxLength={64} required {...form.register('name')} />
      </Field>
      <div className="row-actions">
        <Button loading={register.isPending} type="submit" variant="primary">
          Enregistrer
        </Button>
        <Button onClick={onCancel}>Annuler</Button>
      </div>
    </form>
  )
}
