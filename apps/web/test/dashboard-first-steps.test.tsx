// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FirstSteps } from '../src/features/dashboard/components/first-steps';
import { CATALOGS, renderApp } from './support/render-app';

const { en, es } = CATALOGS;

describe('FirstSteps', () => {
  it('links to create an account when there is none, with no chart or KPI (AC-29)', () => {
    renderApp(<FirstSteps firstSteps={{ hasAccount: false, hasMovement: false, show: true }} />, {
      locale: 'en',
    });
    const create = screen.getByRole('link', { name: en.dashboard.firstSteps.createAccount });
    expect(create.getAttribute('href')).toBe('/en/accounts/new');
    expect(screen.queryByRole('link', { name: en.dashboard.firstSteps.recordMovement })).toBeNull();
    expect(screen.queryByText(en.dashboard.firstSteps.done)).toBeNull();
    expect(screen.queryByText(en.dashboard.netWorth.label)).toBeNull();
    expect(screen.queryByText(en.dashboard.month.title)).toBeNull();
  });

  it('marks the account step done and links to record a movement (AC-30)', () => {
    renderApp(<FirstSteps firstSteps={{ hasAccount: true, hasMovement: false, show: true }} />, {
      locale: 'en',
    });
    expect(screen.getByText(en.dashboard.firstSteps.done)).toBeDefined();
    expect(screen.queryByRole('link', { name: en.dashboard.firstSteps.createAccount })).toBeNull();
    const record = screen.getByRole('link', { name: en.dashboard.firstSteps.recordMovement });
    expect(record.getAttribute('href')).toBe('/en/movements/new');
  });

  it('gives the links a 44 px target class', () => {
    renderApp(<FirstSteps firstSteps={{ hasAccount: false, hasMovement: false, show: true }} />, {
      locale: 'en',
    });
    expect(screen.getByRole('link').className).toContain('min-h-11');
  });

  it('renders the Spanish labels', () => {
    renderApp(<FirstSteps firstSteps={{ hasAccount: true, hasMovement: false, show: true }} />, {
      locale: 'es',
    });
    expect(screen.getByText(es.dashboard.firstSteps.title)).toBeDefined();
    expect(screen.getByText(es.dashboard.firstSteps.done)).toBeDefined();
    expect(
      screen.getByRole('link', { name: es.dashboard.firstSteps.recordMovement }),
    ).toBeDefined();
  });
});
