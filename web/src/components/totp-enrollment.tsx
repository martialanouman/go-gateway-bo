import { useMutation } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { type ReactNode, useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { AuthRefusal } from '~/components/auth-layout'
import { Button, Field, Input } from '~/components/ui'
import type { components } from '~/lib/api.gen'
import { formResolver } from '~/lib/form'
import { totpAttempt } from '~/lib/second-factor'

type Enrollment = components['schemas']['TotpEnrollment']

export type EnrollmentPhase = 'confirm' | 'codes'

/** `qrcode.react` dessine 128 px par défaut, qu'une caméra de téléphone rate à distance de lecture. */
const QR_SIZE = 200

/**
 * **D'abord prouver, ensuite garder** : les dix codes n'apparaissent qu'une fois le premier code
 * accepté. Rien de l'enrôlement ne quitte l'état de ce composant — invariant (b).
 */
export function TotpEnrollment({
  enrollment,
  confirm,
  frame,
  onAcknowledged,
}: {
  readonly enrollment: Enrollment
  readonly confirm: (code: string) => Promise<void>
  readonly frame: (phase: EnrollmentPhase, content: ReactNode) => ReactNode
  readonly onAcknowledged: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)

  if (confirmed) {
    return frame(
      'codes',
      <RecoveryCodes codes={enrollment.recoveryCodes} onAcknowledged={onAcknowledged} />,
    )
  }

  return frame(
    'confirm',
    <TotpConfirmation
      confirm={confirm}
      enrollment={enrollment}
      onConfirmed={() => setConfirmed(true)}
    />,
  )
}

function TotpConfirmation({
  enrollment,
  confirm,
  onConfirmed,
}: {
  readonly enrollment: Enrollment
  readonly confirm: (code: string) => Promise<void>
  readonly onConfirmed: () => void
}) {
  const form = useForm({ resolver: formResolver(totpAttempt), defaultValues: { code: '' } })

  const verify = useMutation({
    gcTime: 0,
    mutationFn: ({ code }: { code: string }) => confirm(code),
    onSuccess: onConfirmed,
  })

  return (
    <>
      {verify.error === null ? null : <AuthRefusal>{verify.error.message}</AuthRefusal>}

      <div className="auth__qr">
        <QRCodeSVG
          marginSize={4}
          size={QR_SIZE}
          title="QR code d’enrôlement de l’application d’authentification"
          value={enrollment.otpauthUri}
        />
      </div>

      <p className="auth__aside">Sans caméra, saisissez la clé ci-dessous à la main.</p>

      <p className="auth__secret">{enrollment.secret}</p>
      <CopyButton done="Clé copiée." label="Copier la clé" value={enrollment.secret} />

      <form
        className="auth__form"
        noValidate
        onSubmit={form.handleSubmit((values) => verify.mutate(values))}
      >
        <Field error={form.formState.errors.code?.message} label="Code à six chiffres">
          <Input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            mono
            required
            {...form.register('code', { onChange: () => verify.reset() })}
          />
        </Field>

        <Button loading={verify.isPending} type="submit" variant="primary">
          Vérifier
        </Button>
      </form>
    </>
  )
}

export function RecoveryCodes({
  codes,
  onAcknowledged,
}: {
  readonly codes: readonly string[]
  readonly onAcknowledged: () => void
}) {
  const codesId = useId()
  const asText = codes.join('\n')

  return (
    <>
      <h2 className="auth__subtitle" id={codesId}>
        Codes de récupération
      </h2>
      <p className="auth__aside">
        Chacun ne sert qu’une fois. Conservez-les hors de cet appareil — un gestionnaire de mots de
        passe, ou une impression en lieu sûr. Quitter cet écran sans les avoir enregistrés les perd
        définitivement.
      </p>
      <ul aria-labelledby={codesId} className="auth__codes">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <CopyButton done="Codes copiés." label="Copier les codes" value={asText} />
      <a
        className="auth__download"
        download="codes-de-recuperation-sms-gateway.txt"
        href={`data:text/plain;charset=utf-8,${encodeURIComponent(`${asText}\n`)}`}
      >
        Télécharger les codes
      </a>

      <Button onClick={onAcknowledged} variant="primary">
        J’ai enregistré ces codes
      </Button>
    </>
  )
}

/** Le retour est écrit et annoncé plutôt que joué : le presse-papiers ne se relit pas à l'œil. */
export function CopyButton({
  label,
  done,
  value,
}: {
  readonly label: string
  readonly done: string
  readonly value: string
}) {
  const [outcome, setOutcome] = useState<string | undefined>(undefined)

  return (
    <>
      <Button
        onClick={() =>
          void navigator.clipboard.writeText(value).then(
            () => setOutcome(done),
            () => setOutcome(COPY_REFUSED),
          )
        }
        variant="secondary"
      >
        {label}
      </Button>
      <p aria-live="polite" className="auth__aside">
        {outcome}
      </p>
    </>
  )
}

const COPY_REFUSED =
  'Le navigateur n’a pas autorisé la copie : sélectionnez la valeur et copiez-la à la main.'
