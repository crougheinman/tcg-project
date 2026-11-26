import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Rulebook } from '../Rulebook';
import { ManualFigure } from '../ManualFigures';
import { HelpLink } from '../HelpLink';
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

describe('the Field Manual: figures and help links', () => {
  const stubWide = (wide: boolean) => {
    window.matchMedia = ((q: string) => ({ matches: wide && q.includes('861'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  };
  afterEach(() => {
    // @ts-expect-error jsdom has no matchMedia until a test stubs one
    delete window.matchMedia;
  });

  it('draws every figure from real card data without error', () => {
    for (const id of ['turn', 'block', 'damage', 'twostep', 'blitz', 'equip', 'ninjutsu', 'board'] as const) {
      const { container, unmount } = render(<ManualFigure id={id} caption="c" />);
      expect(container.querySelector('.fg-' + id), id).toBeTruthy();
      unmount();
    }
  });

  it('shows the numbers from card data (Katana +2/+0 turns a 1/2 Ashigaru into 3/2)', () => {
    const { container } = render(<ManualFigure id="equip" caption="c" />);
    expect(container.textContent).toContain('3/2');
    expect(container.textContent).toContain('Equip {2}');
  });

  it('puts a page’s figure on the right-hand page on a wide window, and in the text after the first paragraph on a narrow one', () => {
    stubWide(true);
    const wide = render(<Rulebook trigger={false} open onOpenChange={() => {}} page="blocking" />);
    expect(document.querySelector('.fm-aside .fg-block')).toBeTruthy();
    expect(document.querySelector('.fm-article .fg-block')).toBeNull();
    wide.unmount();
    stubWide(false);
    render(<Rulebook trigger={false} open onOpenChange={() => {}} page="blocking" />);
    expect(document.querySelector('.fm-aside .fg-block')).toBeNull();
    const kids = [...(document.querySelector('.fm-article')?.children ?? [])];
    const at = kids.findIndex((e) => e.classList.contains('fg'));
    expect(at).toBeGreaterThan(0);
    expect(kids[at - 1].tagName).toBe('P'); // right after the intro paragraph (the kicker and the title come first)
  });

  it('opens the manual at a page from a "?" link', () => {
    const picked: string[] = [];
    render(<HelpLink page="ninjutsu" onOpen={(p) => picked.push(p)} />);
    fireEvent.click(screen.getByRole('button', { name: /how does this work/i }));
    expect(picked).toEqual(['ninjutsu']);
  });
});
