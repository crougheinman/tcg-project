import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatDock } from '../ChatDock';
import { useGame } from '../../store/gameStore';

const sent: string[] = [];
beforeEach(() => {
  sent.length = 0;
  useGame.setState({ sendChat: (t: string) => void sent.push(t) });
});
afterEach(cleanup);

const openChat = () => fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
const panelGone = () => waitFor(() => expect(document.querySelector('.chat-panel')).toBeNull());

describe('the PvP chat panel', () => {
  it('opens with the toggle and stays open while you type', () => {
    render(<ChatDock />);
    expect(document.querySelector('.chat-panel')).toBeNull();
    openChat();
    expect(document.querySelector('.chat-panel')).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/say something/i), { target: { value: 'hel' } });
    expect(document.querySelector('.chat-panel')).not.toBeNull();
    expect(sent).toEqual([]);
  });

  it('closes once a quick message is clicked, and sends it', async () => {
    render(<ChatDock />);
    openChat();
    fireEvent.click(screen.getByRole('button', { name: 'GG' }));
    expect(sent).toEqual(['GG']);
    await panelGone();
  });

  it('closes once a quick emoji is clicked', async () => {
    render(<ChatDock />);
    openChat();
    fireEvent.click(screen.getByRole('button', { name: '👍' }));
    expect(sent).toEqual(['👍']);
    await panelGone();
  });

  it('closes once a typed message is sent with Enter, and the text does not linger', async () => {
    render(<ChatDock />);
    openChat();
    const box = screen.getByPlaceholderText(/say something/i) as HTMLInputElement;
    fireEvent.change(box, { target: { value: '  good game  ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(sent).toEqual(['good game']);
    await panelGone();
    openChat(); // reopen: an empty box
    expect((screen.getByPlaceholderText(/say something/i) as HTMLInputElement).value).toBe('');
  });

  it('closes once a typed message is sent with the Send button', async () => {
    render(<ChatDock />);
    openChat();
    fireEvent.change(screen.getByPlaceholderText(/say something/i), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(sent).toEqual(['hi']);
    await panelGone();
  });

  it('an empty message sends nothing and leaves the panel open', () => {
    render(<ChatDock />);
    openChat();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.keyDown(screen.getByPlaceholderText(/say something/i), { key: 'Enter' });
    expect(sent).toEqual([]);
    expect(document.querySelector('.chat-panel')).not.toBeNull();
  });

  it('can be reopened and used again', async () => {
    render(<ChatDock />);
    openChat();
    fireEvent.click(screen.getByRole('button', { name: 'Nice!' }));
    await panelGone();
    openChat();
    fireEvent.click(screen.getByRole('button', { name: 'Oops' }));
    expect(sent).toEqual(['Nice!', 'Oops']);
    await panelGone();
  });
});
