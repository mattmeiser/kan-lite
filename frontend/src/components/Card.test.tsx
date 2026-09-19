import { describe, expect, it } from 'vitest';
import { computeEdge } from './Card';

describe('computeEdge', () => {
  const rect = { top: 100, height: 40 };

  it('is "above" when the pointer is in the top half of the card', () => {
    expect(computeEdge(110, rect)).toBe('above');
  });

  it('is "below" when the pointer is in the bottom half of the card', () => {
    expect(computeEdge(135, rect)).toBe('below');
  });

  it('treats the exact midpoint as "below"', () => {
    expect(computeEdge(120, rect)).toBe('below');
  });
});
