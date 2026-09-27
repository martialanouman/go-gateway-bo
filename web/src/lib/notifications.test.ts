import { describe, expect, it } from 'vitest'
import type { components } from './api.gen'
import { describeNotification, toastSource } from './notifications'

type Notification = components['schemas']['Notification']
type BillingAlert = components['schemas']['BillingAlert']

function billing(details: Partial<BillingAlert> = {}): Notification {
  return {
    id: '01960000-0000-7000-8000-00000000000a',
    source: 'billing_alert_stream',
    severity: 'warning',
    kind: 'billing_alert',
    details: {
      customerId: 'cust-9',
      ownerType: 'customer',
      ownerId: 'cust-9',
      alert: 'mo_floor_reached',
      balance: -5000,
      ...details,
    },
    createdAt: '2026-09-27T08:05:00Z',
  }
}

const minusFiveThousand = (-5000).toLocaleString('fr-FR')

describe('describeNotification', () => {
  it('names the customer balance on an MO floor', () => {
    expect(describeNotification(billing({ ownerType: 'customer' }))).toEqual({
      title: 'Plancher de facturation MO atteint',
      description: `Le solde du client cust-9 est à ${minusFiveThousand} crédits.`,
    })
    expect(minusFiveThousand).toMatch(/^-5\s000$/)
  })

  it('names the SMPP account and its customer', () => {
    expect(
      describeNotification(billing({ ownerType: 'smpp_account', ownerId: 'acct-3' })).description,
    ).toBe(`Le solde du compte SMPP acct-3 du client cust-9 est à ${minusFiveThousand} crédits.`)
  })

  it('falls back to the raw owner type', () => {
    expect(
      describeNotification(billing({ ownerType: 'reseller', ownerId: 'r-1' })).description,
    ).toBe(`Le solde reseller r-1 du client cust-9 est à ${minusFiveThousand} crédits.`)
  })

  it('names an unknown alert without inventing its meaning', () => {
    expect(describeNotification(billing({ alert: 'low_balance' }))).toEqual({
      title: 'Alerte de facturation',
      description: 'Alerte « low_balance » sur le solde du client cust-9.',
    })
  })

  it('shows a free-text message as it is', () => {
    expect(
      describeNotification({
        id: '01960000-0000-7000-8000-00000000000b',
        source: 'alertmanager',
        severity: 'critical',
        kind: 'message',
        message: 'Connecteur orange-ci injoignable depuis 5 min.',
        createdAt: '2026-09-27T08:05:00Z',
      }),
    ).toEqual({ title: 'Alerte', description: 'Connecteur orange-ci injoignable depuis 5 min.' })
  })
})

describe('toastSource', () => {
  it('keeps Alertmanager apart from what the BFF detects', () => {
    expect(toastSource('alertmanager')).toBe('alertmanager')
    expect(toastSource('billing_alert_stream')).toBe('bff')
    expect(toastSource('bff_evaluator')).toBe('bff')
  })
})
