import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RailSection } from './RailSection';

describe('RailSection', () => {
  it('is expanded by default, showing its children', () => {
    render(
      <RailSection title="Planning">
        <div>Priority: High</div>
      </RailSection>,
    );
    expect(screen.getByText('Priority: High')).toBeInTheDocument();
  });

  it('starts collapsed when defaultExpanded is false', () => {
    render(
      <RailSection title="Related" defaultExpanded={false}>
        <div>Nothing linked yet</div>
      </RailSection>,
    );
    expect(screen.queryByText('Nothing linked yet')).not.toBeInTheDocument();
  });

  it('toggles visibility of its children on header click', async () => {
    render(
      <RailSection title="Planning">
        <div>Priority: High</div>
      </RailSection>,
    );

    await userEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('Priority: High')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Priority: High')).toBeInTheDocument();
  });

  it('shows an optional count badge next to the title', () => {
    render(
      <RailSection title="Related" count={3}>
        <div>content</div>
      </RailSection>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
