// @vitest-environment happy-dom
import { CATEGORY_NAME_MAX_LENGTH, type CategoryResponse } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CategoriesContainer } from '../src/features/categories/containers/categories-container';
import { CreateCategoryContainer } from '../src/features/categories/containers/create-category-container';
import { category, defaultRow, page, seededDefaults, uuid } from './support/category-fixtures';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;

const ACTIVE = 'GET /categories?archived=false&limit=100&offset=0';
const ARCHIVED = 'GET /categories?archived=true&limit=100&offset=0';
const ARCHIVED_AT = '2026-10-02T00:00:00.000Z';

const MASCOTAS = category({ id: uuid(900) });

type User = ReturnType<typeof userEvent.setup>;

function row(name: string) {
  return screen.getByRole('listitem', { name });
}

/** Opens a row's actions ("⋯") and runs one of them, e.g. `rowAction(user, 'Editar', 'Comida')`. */
async function rowAction(user: User, action: string, name: string) {
  await user.click(await screen.findByRole('button', { name: `Acciones de ${name}` }));
  await user.click(screen.getByRole('button', { name: `${action} ${name}` }));
}

/** Opens the create form with "+ New". */
async function openCreate(user: User) {
  await user.click(screen.getByRole('button', { name: es.categories.new.open }));
}

describe('CategoriesContainer', () => {
  it('shows the loading state, then the Spanish defaults with es (AC-14)', async () => {
    const { calls } = stubApi({ [ACTIVE]: page(seededDefaults()) });
    renderApp(<CategoriesContainer />, { locale: 'es' });

    expect(screen.getByRole('status').textContent).toBe(es.app.loading);
    expect(await screen.findByRole('listitem', { name: 'Comida' })).toBeDefined();
    expect(screen.getByRole('listitem', { name: 'Supermercado' })).toBeDefined();
    expect(calls.map((call) => call.path)).toEqual([
      '/categories?archived=false&limit=100&offset=0',
    ]);
  });

  it('shows the English defaults with en (AC-15)', async () => {
    stubApi({ [ACTIVE]: page(seededDefaults()) });
    renderApp(<CategoriesContainer />, { locale: 'en' });

    expect(await screen.findByRole('listitem', { name: 'Food' })).toBeDefined();
    expect(screen.getByRole('listitem', { name: 'Groceries' })).toBeDefined();
    expect(screen.queryByRole('listitem', { name: 'Comida' })).toBeNull();
  });

  it('keeps a renamed default under its custom name in either language (AC-16, AC-17)', async () => {
    const renamed = seededDefaults().map((entry) =>
      entry.key === 'food' ? { ...entry, name: 'Mi comida' } : entry,
    );
    stubApi({ [ACTIVE]: page(renamed) });
    renderApp(<CategoriesContainer />, { locale: 'en' });

    expect(await screen.findByRole('listitem', { name: 'Mi comida' })).toBeDefined();
    expect(screen.getByRole('listitem', { name: 'Groceries' })).toBeDefined();
  });

  it('pages through the list until the total is reached', async () => {
    const custom = Array.from({ length: 68 }, (_, index) =>
      category({
        id: uuid(1000 + index),
        name: `Extra ${String(index)}`,
        createdAt: '2026-10-03T00:00:00.000Z',
      }),
    );
    const all = [...seededDefaults(), ...custom];
    const { calls } = stubApi({
      [ACTIVE]: page(all.slice(0, 100), 101, 0),
      'GET /categories?archived=false&limit=100&offset=100': page(all.slice(100), 101, 100),
    });
    renderApp(<CategoriesContainer />);

    expect(await screen.findByRole('listitem', { name: 'Extra 67' })).toBeDefined();
    expect(screen.getByRole('listitem', { name: 'Extra 0' })).toBeDefined();
    expect(calls.map((call) => call.path)).toEqual([
      '/categories?archived=false&limit=100&offset=0',
      '/categories?archived=false&limit=100&offset=100',
    ]);
  });

  it('renders only the categories the API answered (AC-13)', async () => {
    stubApi({ [ACTIVE]: page([MASCOTAS]) });
    renderApp(<CategoriesContainer />);

    expect(await screen.findByRole('listitem', { name: 'Mascotas' })).toBeDefined();
    expect(screen.queryByRole('listitem', { name: 'Comida' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('renders a name containing markup as literal text (error path, invalid markup)', async () => {
    const name = '<img src=x onerror="alert(1)">';
    stubApi({ [ACTIVE]: page([category({ name })]) });
    const { container } = renderApp(<CategoriesContainer />);

    expect((await screen.findAllByText(name)).length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows the retry state when the API is unreachable and loads on retry (error path)', async () => {
    stubApi({ [ACTIVE]: ['network-error', page([MASCOTAS])] });
    renderApp(<CategoriesContainer />, { locale: 'en' });

    expect(await screen.findByText(en.errors.network)).toBeDefined();
    expect(screen.queryByRole('list')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: en.app.retry }));

    expect(await screen.findByRole('listitem', { name: 'Mascotas' })).toBeDefined();
    expect(screen.queryByText(en.errors.network)).toBeNull();
  });

  it('sends the user to sign-in when the session is gone', async () => {
    stubApi({ [ACTIVE]: { status: 401, body: { code: 'UNAUTHENTICATED' } } });
    const { router } = renderApp(<CategoriesContainer />);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });

  it('edits inline and shows the new name, icon and color (AC-05)', async () => {
    const updated = category({ name: 'Perros', icon: 'baby', color: 'blue' });
    const { calls } = stubApi({
      [ACTIVE]: page([MASCOTAS]),
      [`PATCH /categories/${uuid(900)}`]: { status: 200, body: updated },
    });
    const { container } = renderApp(<CategoriesContainer />);
    const user = userEvent.setup();

    await rowAction(user, 'Editar', 'Mascotas');
    const name = screen.getByLabelText('Nuevo nombre de Mascotas');
    await user.clear(name);
    await user.type(name, '  Perros ');
    const editRow = row('Mascotas');
    await user.click(within(editRow).getByRole('radio', { name: es.categories.icons.baby }));
    await user.click(within(editRow).getByRole('radio', { name: es.categories.colors.blue }));
    await user.click(within(editRow).getByRole('button', { name: es.categories.actions.save }));

    expect(await screen.findByRole('listitem', { name: 'Perros' })).toBeDefined();
    expect(screen.queryByLabelText(/Nuevo nombre/)).toBeNull();
    expect(container.querySelector('[data-icon="baby"][data-color="blue"]')).not.toBeNull();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      name: 'Perros',
      icon: 'baby',
      color: 'blue',
    });
  });

  it('does not rename a default when only its color changes (D4)', async () => {
    const food = defaultRow('food');
    const { calls } = stubApi({
      [ACTIVE]: page([food]),
      [`PATCH /categories/${uuid(1)}`]: { status: 200, body: { ...food, color: 'blue' } },
    });
    renderApp(<CategoriesContainer />);
    const user = userEvent.setup();

    await rowAction(user, 'Editar', 'Comida');
    const editRow = screen.getByRole('listitem', { name: 'Comida' });
    await user.click(within(editRow).getByRole('radio', { name: es.categories.colors.blue }));
    await user.click(screen.getByRole('button', { name: es.categories.actions.save }));

    expect(await screen.findByRole('listitem', { name: 'Comida' })).toBeDefined();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ color: 'blue' });
  });

  it('closes the edit without a request when nothing changed', async () => {
    const { calls } = stubApi({ [ACTIVE]: page([MASCOTAS]) });
    renderApp(<CategoriesContainer />);
    const user = userEvent.setup();

    await rowAction(user, 'Editar', 'Mascotas');
    await user.click(screen.getByRole('button', { name: es.categories.actions.save }));

    expect(screen.queryByLabelText(/Nuevo nombre/)).toBeNull();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  it('keeps the edit open with the duplicate-name message (AC-11)', async () => {
    stubApi({
      [ACTIVE]: page([MASCOTAS]),
      [`PATCH /categories/${uuid(900)}`]: { status: 409, body: { code: 'CATEGORY_NAME_TAKEN' } },
    });
    renderApp(<CategoriesContainer />);
    const user = userEvent.setup();

    await rowAction(user, 'Editar', 'Mascotas');
    const name = screen.getByLabelText('Nuevo nombre de Mascotas');
    await user.clear(name);
    await user.type(name, 'Comida');
    await user.click(screen.getByRole('button', { name: es.categories.actions.save }));

    expect(await screen.findByText(es.errors.categoryNameTaken)).toBeDefined();
    expect(name.getAttribute('aria-invalid')).toBe('true');
  });

  it('does not send an empty or invisible-character name and says why', async () => {
    const { calls } = stubApi({ [ACTIVE]: page([MASCOTAS]) });
    renderApp(<CategoriesContainer />);
    const user = userEvent.setup();

    await rowAction(user, 'Editar', 'Mascotas');
    const name = screen.getByLabelText('Nuevo nombre de Mascotas');
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: es.categories.actions.save }));
    expect(await screen.findByText(es.categories.errors.nameRequired)).toBeDefined();

    await user.type(name, 'Perros\u200B');
    await user.click(screen.getByRole('button', { name: es.categories.actions.save }));
    expect(await screen.findByText(es.categories.errors.nameInvalidCharacters)).toBeDefined();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  it('archives a parent out of the active view with its subcategories and unarchives it (AC-06, AC-07, AC-08)', async () => {
    const food = defaultRow('food', { archived: true, archivedAt: ARCHIVED_AT });
    const groceries = defaultRow('food.groceries', { archived: true, archivedAt: ARCHIVED_AT });
    const all = [defaultRow('food'), defaultRow('food.groceries'), MASCOTAS];
    const { calls } = stubApi({
      [ACTIVE]: [page(all), page([MASCOTAS]), page(all)],
      [ARCHIVED]: [page([food, groceries]), page([groceries])],
      [`POST /categories/${uuid(1)}/archive`]: { status: 200, body: food },
      [`POST /categories/${uuid(1)}/unarchive`]: {
        status: 200,
        body: defaultRow('food'),
      },
    });
    renderApp(<CategoriesContainer />);
    const user = userEvent.setup();

    await rowAction(user, 'Archivar', 'Comida');
    await waitFor(() => {
      expect(screen.queryByRole('listitem', { name: 'Comida' })).toBeNull();
    });
    expect(screen.queryByRole('listitem', { name: 'Supermercado' })).toBeNull();
    expect(screen.getByRole('listitem', { name: 'Mascotas' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: es.categories.list.viewArchived }));
    expect(await screen.findByRole('listitem', { name: 'Comida' })).toBeDefined();
    expect(screen.getByRole('listitem', { name: 'Supermercado' })).toBeDefined();

    await rowAction(user, 'Desarchivar', 'Comida');
    await waitFor(() => {
      expect(screen.queryByRole('listitem', { name: 'Comida' })).toBeNull();
    });
    // Unarchiving a parent does not unarchive its subcategories (D7).
    expect(screen.getByRole('listitem', { name: 'Supermercado' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: es.categories.list.viewActive }));
    expect(await screen.findByRole('listitem', { name: 'Comida' })).toBeDefined();
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
      `/categories/${uuid(1)}/archive`,
      `/categories/${uuid(1)}/unarchive`,
    ]);
  });

  it('asks for confirmation before deleting and then removes the row (AC-09)', async () => {
    const { calls } = stubApi({
      [ACTIVE]: [page([MASCOTAS, defaultRow('salary')]), page([defaultRow('salary')])],
      [`DELETE /categories/${uuid(900)}`]: { status: 204 },
    });
    renderApp(<CategoriesContainer />);
    const user = userEvent.setup();

    await rowAction(user, 'Eliminar', 'Mascotas');

    expect(screen.getByRole('status').textContent).toBe(
      es.categories.actions.confirmDelete.replace('{name}', 'Mascotas'),
    );
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: es.categories.actions.confirmDeleteYes }));

    await waitFor(() => {
      expect(screen.queryByRole('listitem', { name: 'Mascotas' })).toBeNull();
    });
    // The income categories wait on their own tab.
    await user.click(screen.getByRole('button', { name: es.categories.sections.income }));
    expect(screen.getByRole('listitem', { name: 'Sueldo' })).toBeDefined();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('does not delete when the confirmation is cancelled', async () => {
    const { calls } = stubApi({ [ACTIVE]: page([MASCOTAS]) });
    renderApp(<CategoriesContainer />);
    const user = userEvent.setup();

    await rowAction(user, 'Eliminar', 'Mascotas');
    await user.click(screen.getByRole('button', { name: es.categories.actions.cancel }));

    expect(screen.queryByText(es.categories.actions.confirmDeleteYes)).toBeNull();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  });

  it('answers a refused deletion with the message and an archive-instead action (AC-10)', async () => {
    const archived = { ...MASCOTAS, archived: true, archivedAt: ARCHIVED_AT };
    const { calls } = stubApi({
      [ACTIVE]: [page([MASCOTAS]), page([])],
      [`DELETE /categories/${uuid(900)}`]: { status: 409, body: { code: 'CATEGORY_IN_USE' } },
      [`POST /categories/${uuid(900)}/archive`]: { status: 200, body: archived },
    });
    renderApp(<CategoriesContainer />);
    const user = userEvent.setup();

    await rowAction(user, 'Eliminar', 'Mascotas');
    await user.click(screen.getByRole('button', { name: es.categories.actions.confirmDeleteYes }));

    expect(await screen.findByText(es.errors.categoryInUse)).toBeDefined();
    expect(screen.getByRole('listitem', { name: 'Mascotas' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: es.categories.actions.archiveInstead }));

    expect(await screen.findByText(es.categories.list.empty)).toBeDefined();
    expect(screen.queryByText(es.errors.categoryInUse)).toBeNull();
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
      `/categories/${uuid(900)}/archive`,
    ]);
  });

  it('shows an unreachable API during an action in an alert and keeps the row', async () => {
    stubApi({
      [ACTIVE]: page([MASCOTAS]),
      [`POST /categories/${uuid(900)}/archive`]: 'network-error',
    });
    renderApp(<CategoriesContainer />, { locale: 'en' });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Actions for Mascotas' }));
    await user.click(screen.getByRole('button', { name: 'Archive Mascotas' }));

    expect((await screen.findByRole('alert')).textContent).toContain(en.errors.network);
    expect(screen.getByRole('listitem', { name: 'Mascotas' })).toBeDefined();
  });

  it('creates a category from the page and shows it (AC-02)', async () => {
    const created = category({ id: uuid(901), name: 'Café', icon: 'coffee', color: 'amber' });
    const { calls } = stubApi({
      [ACTIVE]: page(seededDefaults()),
      'POST /categories': { status: 201, body: created },
    });
    renderApp(<CategoriesContainer />);
    const user = userEvent.setup();

    await screen.findByRole('listitem', { name: 'Comida' });
    await openCreate(user);
    await user.type(screen.getByLabelText(es.categories.fields.name), ' Café ');
    await user.click(screen.getByRole('radio', { name: es.categories.icons.coffee }));
    await user.click(screen.getByRole('radio', { name: es.categories.colors.amber }));
    await user.click(screen.getByRole('button', { name: es.categories.form.submit }));

    expect(await screen.findByRole('listitem', { name: 'Café' })).toBeDefined();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    // The form closes once the category is in the list.
    expect(screen.queryByLabelText(es.categories.fields.name)).toBeNull();
  });

  it('creates a subcategory under an active parent and shows it under that parent', async () => {
    const created = category({
      id: uuid(901),
      name: 'Café',
      parentId: uuid(1),
      icon: 'coffee',
      color: 'orange',
    });
    const { calls } = stubApi({
      [ACTIVE]: page(seededDefaults()),
      'POST /categories': { status: 201, body: created },
    });
    renderApp(<CategoriesContainer />);
    const user = userEvent.setup();

    await screen.findByRole('listitem', { name: 'Comida' });
    await openCreate(user);
    await user.selectOptions(screen.getByLabelText(es.categories.fields.parent), uuid(1));
    await user.type(screen.getByLabelText(es.categories.fields.name), 'Café');
    await user.click(screen.getByRole('radio', { name: es.categories.icons.coffee }));
    await user.click(screen.getByRole('radio', { name: es.categories.colors.orange }));
    await user.click(screen.getByRole('button', { name: es.categories.form.submit }));

    const child = await within(row('Comida')).findByRole('listitem', { name: 'Café' });
    expect(child).toBeDefined();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'Café',
      kind: 'expense',
      icon: 'coffee',
      color: 'orange',
      parentId: uuid(1),
    });
  });

  it('hides the create form in the archived view, where parents would be archived', async () => {
    stubApi({ [ACTIVE]: page([MASCOTAS]), [ARCHIVED]: page([]) });
    renderApp(<CategoriesContainer />);

    await screen.findByRole('listitem', { name: 'Mascotas' });
    const user = userEvent.setup();
    await openCreate(user);
    expect(screen.getByLabelText(es.categories.fields.name)).toBeDefined();
    await user.click(screen.getByRole('button', { name: es.categories.list.viewArchived }));
    expect(await screen.findByText(es.categories.list.emptyArchived)).toBeDefined();
    expect(screen.queryByLabelText(es.categories.fields.name)).toBeNull();
    expect(screen.queryByRole('button', { name: es.categories.new.open })).toBeNull();
  });
});

async function fillValid(user: User, name = 'Café') {
  await user.type(screen.getByLabelText(es.categories.fields.name), name);
  await user.click(screen.getByRole('radio', { name: es.categories.icons.coffee }));
  await user.click(screen.getByRole('radio', { name: es.categories.colors.amber }));
}

async function submit(user: User) {
  await user.click(screen.getByRole('button', { name: es.categories.form.submit }));
}

function renderCreate(onCreated: (created: CategoryResponse) => void = vi.fn()) {
  return {
    onCreated,
    ...renderApp(
      <CreateCategoryContainer categories={seededDefaults()} language="es" onCreated={onCreated} />,
    ),
  };
}

describe('CreateCategoryContainer', () => {
  it('creates the category once with the validated body and reports it (AC-02)', async () => {
    const created = category({ id: uuid(901), name: 'Café' });
    const { calls } = stubApi({ 'POST /categories': { status: 201, body: created } });
    const { onCreated } = renderCreate();
    const user = userEvent.setup();

    await fillValid(user, '  Café ');
    await submit(user);

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(created);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      name: 'Café',
      kind: 'expense',
      icon: 'coffee',
      color: 'amber',
    });
    expect(calls[0]?.body).not.toHaveProperty('parentId');
  });

  it('names each missing field, focuses the first one and sends nothing (AC-02)', async () => {
    const { calls } = stubApi({});
    const { onCreated } = renderCreate();

    await submit(userEvent.setup());

    expect(await screen.findByText(es.categories.errors.nameRequired)).toBeDefined();
    expect(screen.getByText(es.categories.errors.iconRequired)).toBeDefined();
    expect(screen.getByText(es.categories.errors.colorRequired)).toBeDefined();
    expect(screen.getByLabelText(es.categories.fields.name).getAttribute('aria-invalid')).toBe(
      'true',
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(es.categories.fields.name));
    });
    expect(calls).toHaveLength(0);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('treats a blank name as missing, a long one as too long and invisible characters as invalid', async () => {
    const { calls } = stubApi({});
    renderCreate();
    const user = userEvent.setup();

    await fillValid(user, '   ');
    await submit(user);
    expect(await screen.findByText(es.categories.errors.nameRequired)).toBeDefined();

    const name = screen.getByLabelText(es.categories.fields.name);
    await user.clear(name);
    await user.type(name, 'x'.repeat(CATEGORY_NAME_MAX_LENGTH + 1));
    await submit(user);
    expect(
      await screen.findByText(
        es.categories.errors.nameTooLong.replace('{max}', String(CATEGORY_NAME_MAX_LENGTH)),
      ),
    ).toBeDefined();

    await user.clear(name);
    await user.type(name, 'Caf\u200B');
    await submit(user);
    expect(await screen.findByText(es.categories.errors.nameInvalidCharacters)).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['CATEGORY_NESTING_TOO_DEEP', es.errors.categoryNestingTooDeep],
    ['CATEGORY_PARENT_KIND_MISMATCH', es.errors.categoryParentKindMismatch],
  ])('shows a %s answer on the parent field (AC-03, AC-04)', async (code, message) => {
    stubApi({ 'POST /categories': { status: 400, body: { code } } });
    const { onCreated } = renderCreate();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(es.categories.fields.parent), uuid(1));
    await fillValid(user);
    await submit(user);

    expect(await screen.findByText(message)).toBeDefined();
    const parent = screen.getByLabelText(es.categories.fields.parent);
    expect(parent.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => {
      expect(document.activeElement).toBe(parent);
    });
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('shows the duplicate-name message on the name field (AC-11)', async () => {
    stubApi({ 'POST /categories': { status: 409, body: { code: 'CATEGORY_NAME_TAKEN' } } });
    renderCreate();
    const user = userEvent.setup();

    await fillValid(user, 'Comida');
    await submit(user);

    expect(await screen.findByText(es.errors.categoryNameTaken)).toBeDefined();
    const name = screen.getByLabelText(es.categories.fields.name);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => {
      expect(document.activeElement).toBe(name);
    });
  });

  it('shows the retry alert on a network failure and keeps the typed values (error path)', async () => {
    const created = category({ id: uuid(901), name: 'Café' });
    const { calls } = stubApi({
      'POST /categories': ['network-error', { status: 201, body: created }],
    });
    const { onCreated } = renderCreate();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(es.categories.fields.parent), uuid(1));
    await fillValid(user);
    await submit(user);

    expect(await screen.findByText(es.errors.network)).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>(es.categories.fields.name).value).toBe('Café');
    expect(screen.getByLabelText<HTMLSelectElement>(es.categories.fields.parent).value).toBe(
      uuid(1),
    );
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: es.categories.icons.coffee }).checked,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: es.categories.colors.amber }).checked,
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: es.categories.form.submit }).hasAttribute('disabled'),
    ).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();

    await submit(user);
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(created);
    });
    expect(calls).toHaveLength(2);
  });

  it('shows an unexpected failure above the form', async () => {
    stubApi({ 'POST /categories': { status: 500, body: { code: 'INTERNAL' } } });
    renderCreate();
    const user = userEvent.setup();

    await fillValid(user);
    await submit(user);

    expect(await screen.findByText(es.errors.unexpected)).toBeDefined();
  });

  it('sends the user to sign-in when the session is gone', async () => {
    stubApi({ 'POST /categories': { status: 401, body: { code: 'UNAUTHENTICATED' } } });
    const { router } = renderCreate();
    const user = userEvent.setup();

    await fillValid(user);
    await submit(user);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });
});
