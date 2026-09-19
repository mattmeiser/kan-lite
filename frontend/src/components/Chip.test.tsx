import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chip } from './Chip';

describe('Chip', () => {
  it('renders its label', () => {
    render(<Chip label="Urgent" color="red" />);
    expect(screen.getByText('Urgent')).toBeInTheDocument();
  });

  it('reflects pressed state via aria-pressed', () => {
    render(<Chip label="Urgent" pressed />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('defaults to not pressed', () => {
    render(<Chip label="Urgent" />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<Chip label="Urgent" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
