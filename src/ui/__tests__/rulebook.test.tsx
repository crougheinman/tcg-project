import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Rulebook } from '../Rulebook';
import { PAGES } from '../../rulebook/content';

afterEach(cleanup);

const open = () => {
  render(<Rulebook />);
  fireEvent.click(screen.getByRole('button', { name: /open field manual/i }));
  return screen.getByRole('dialog', { name: /field manual/i });
};
const heading = () => document.querySelector('.fm-h')?.textContent;
const counter = () => document.querySelector('.fm-count-pill')?.textContent;
// framer-motion's AnimatePresence holds a leaving page for a moment; let it go.
const settle = () => act(() => new Promise((r) => setTimeout(r, 400)));

describe('the Field Manual', () => {
  it('opens on the first page, in a portal on <body>, and closes with Esc', async () => {
    const dialog = open();
    expect(heading()).toBe(PAGES[0].title);
    expect(counter()).toBe(`1 / ${PAGES.length}`);
    // a portal: not inside the element React rendered into, so a game board's stacking context cannot cover it
    expect(dialog.closest('[data-testid]')).toBeNull();
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('turns pages with the buttons and the arrow keys, and stops at the first page', async () => {
    const dialog = open();
    expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await settle();
    expect(counter()).toBe(`2 / ${PAGES.length}`);
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    await settle();
    expect(counter()).toBe(`3 / ${PAGES.length}`);
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    await settle();
    expect(counter()).toBe(`2 / ${PAGES.length}`);
  });

  it('jumps to a chapter from its tab and marks that tab selected', async () => {
    open();
    fireEvent.click(screen.getByRole('tab', { name: /keywords/i }));
    await settle();
    const first = PAGES.find((p) => p.chapter === 'keywords')!;
    expect(heading()).toBe(first.title);
    expect(screen.getByRole('tab', { name: /keywords/i }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /basics/i }).getAttribute('aria-selected')).toBe('false');
  });

  it('searches, lists results, opens one with its words lit, and keeps the keys working afterwards', async () => {
    const dialog = open();
    fireEvent.change(screen.getByRole('searchbox', { name: /search the manual/i }), { target: { value: 'mulligan' } });
    const results = screen.getByRole('region', { name: /search results/i });
    const buttons = results.querySelectorAll('li button');
    expect(buttons.length).toBeGreaterThan(0);
    (buttons[0] as HTMLElement).focus(); // a real click focuses the button, which then unmounts with the results
    fireEvent.click(buttons[0]);
    await settle();
    expect(heading()).toBe('Opening hand and mulligan');
    expect(screen.queryByRole('region', { name: /search results/i })).toBeNull();
    expect(document.querySelectorAll('.fm-page mark').length).toBeGreaterThan(0);
    // the clicked result button is gone; the keys must still land on the book
    expect(document.activeElement).toBe(dialog);
  });

  it('says so when nothing matches, and Esc backs out of a search before it closes the book', async () => {
    const dialog = open();
    const box = screen.getByRole('searchbox', { name: /search the manual/i });
    box.focus();
    fireEvent.change(box, { target: { value: 'zzzzqq' } });
    expect(screen.getByText(/nothing found/i)).toBeTruthy();
    fireEvent.keyDown(box, { key: 'Escape' });
    await settle();
    expect((box as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('region', { name: /search results/i })).toBeNull();
    expect(screen.getByRole('dialog')).toBe(dialog); // still open
  });

  it('can open at a given page', () => {
    render(<Rulebook trigger={false} open onOpenChange={() => {}} page="ninjutsu" />);
    expect(heading()).toBe('Ninjutsu');
  });
});
