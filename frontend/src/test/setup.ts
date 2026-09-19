import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// RTL's own auto-cleanup relies on detecting global test hooks; this project
// keeps `vitest`'s globals off (explicit imports everywhere else, backend
// included), so register it explicitly instead.
afterEach(() => {
  cleanup();
});
